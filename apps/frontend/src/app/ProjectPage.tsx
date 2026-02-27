import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createProject,
  copyProject,
  deleteProject,
  importArxivSSE,
  importZip,
  listProjects,
  listTemplates,
  renameProject,
  archiveProject,
  trashProject,
  updateProjectTags,
  permanentDeleteProject,
  uploadTemplate
} from '../api/client';
import type { ProjectMeta, TemplateMeta, TemplateCategory } from '../api/client';
import TransferPanel from './TransferPanel';
import { useAuth } from '../auth/AuthContext';

type ViewFilter = 'all' | 'mine' | 'archived' | 'trash';
type SortBy = 'updatedAt' | 'name' | 'createdAt';

const SETTINGS_KEY = 'manuscripta-settings-v1';

interface LLMSettings {
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
}

const DEFAULT_LLM: LLMSettings = {
  llmEndpoint: 'https://api.openai.com/v1/chat/completions',
  llmApiKey: '',
  llmModel: 'gpt-4o',
};

function loadLLMSettings(): LLMSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_LLM;
    const parsed = JSON.parse(raw);
    return {
      llmEndpoint: parsed.llmEndpoint ?? DEFAULT_LLM.llmEndpoint,
      llmApiKey: parsed.llmApiKey ?? DEFAULT_LLM.llmApiKey,
      llmModel: parsed.llmModel ?? DEFAULT_LLM.llmModel,
    };
  } catch {
    return DEFAULT_LLM;
  }
}

function saveLLMSettings(s: LLMSettings) {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const prev = raw ? JSON.parse(raw) : {};
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...prev, ...s }));
  } catch {}
}

function formatRelativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${n} min ago`;
  if (diff < 86_400_000) return `${n} hr ago`;
  return `${n} days ago`;
}

export default function ProjectPage() {
  const navigate = useNavigate();
  const { authEnabled, user, logout } = useAuth();

  useEffect(() => { document.title = `${'Projects'} — Manuscripta`; }, []);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');

  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagsExpanded, setTagsExpanded] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTemplate, setCreateTemplate] = useState('');
  const [renameState, setRenameState] = useState<{ id: string; value: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [arxivInput, setArxivInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ phase: string; percent: number } | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);

  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<LLMSettings>(loadLLMSettings);

  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const [galleryCat, setGalleryCat] = useState('all');
  const [galleryFeatured, setGalleryFeatured] = useState(false);
  const [gallerySearch, setGallerySearch] = useState('');
  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [newSidebarTag, setNewSidebarTag] = useState('');
  const [addingSidebarTag, setAddingSidebarTag] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Transfer modal state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSource, setTransferSource] = useState<{ id: string; name: string } | null>(null);

  // Active transfer job (persists after modal close)
  const [activeJob, setActiveJob] = useState<{
    jobId: string; status: string; progressLog: string[]; error?: string;
    sourceName?: string;
  } | null>(null);
  const [jobWidgetOpen, setJobWidgetOpen] = useState(true);

  // Template upload state
  const templateZipRef = useRef<HTMLInputElement | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const loadProjects = useCallback(async () => {
    const res = await listProjects();
    setProjects(res.projects || []);
  }, []);

  useEffect(() => {
    loadProjects().catch((err) => setStatus(`Failed to load projects: ${error}`));
  }, [loadProjects]);

  useEffect(() => {
    listTemplates()
      .then((res) => {
        setTemplates(res.templates || []);
        setCategories(res.categories || []);
        if (res.templates?.length && !createTemplate) {
          setCreateTemplate(res.templates[0].id);
        }
      })
      .catch((err) => setStatus(`Failed to load templates: ${error}`));
  }, [createTemplate]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    projects.forEach((p) => (p.tags || []).forEach((tag) => s.add(tag)));
    return Array.from(s).sort();
  }, [projects]);

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (viewFilter === 'archived') list = list.filter((p) => p.archived && !p.trashed);
    else if (viewFilter === 'trash') list = list.filter((p) => p.trashed);
    else if (viewFilter === 'mine') list = list.filter((p) => !p.archived && !p.trashed);
    else list = list.filter((p) => !p.trashed);
    if (activeTag) list = list.filter((p) => (p.tags || []).includes(activeTag));
    const term = filter.trim().toLowerCase();
    if (term) list = list.filter((p) => p.name.toLowerCase().includes(term));
    list = [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'createdAt') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
    return list;
  }, [projects, viewFilter, activeTag, filter, sortBy]);

  const viewCounts = useMemo(() => ({
    all: projects.filter((p) => !p.trashed).length,
    mine: projects.filter((p) => !p.archived && !p.trashed).length,
    archived: projects.filter((p) => p.archived && !p.trashed).length,
    trash: projects.filter((p) => p.trashed).length,
  }), [projects]);

  const galleryTemplates = useMemo(() => {
    let list = templates;
    if (galleryCat !== 'all') list = list.filter((tpl) => tpl.category === galleryCat);
    if (galleryFeatured) list = list.filter((tpl) => tpl.featured);
    const term = gallerySearch.trim().toLowerCase();
    if (term) list = list.filter((tpl) =>
      tpl.label.toLowerCase().includes(term) ||
      (tpl.description || '').toLowerCase().includes(term) ||
      (tpl.descriptionEn || '').toLowerCase().includes(term)
    );
    return list;
  }, [templates, galleryCat, galleryFeatured, gallerySearch]);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) {
      setStatus('Enter a project name.');
      return;
    }
    try {
      const created = await createProject({ name, template: createTemplate || undefined });
      setCreateOpen(false);
      setCreateName('');
      await loadProjects();
      navigate(`/editor/${created.id}`);
    } catch (err) {
      setStatus(`Create failed: ${error}`);
    }
  };

  const handleRename = async () => {
    if (!renameState) return;
    const name = renameState.value.trim();
    if (!name) {
      setRenameState(null);
      return;
    }
    try {
      await renameProject(renameState.id, name);
      setRenameState(null);
      await loadProjects();
    } catch (err) {
      setStatus(`Rename failed: ${error}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete project ${name}? This cannot be undone.`)) return;
    try {
      await deleteProject(id);
      await loadProjects();
    } catch (err) {
      setStatus(`Delete failed: ${error}`);
    }
  };

  const handleArchive = async (id: string, archived: boolean) => {
    try {
      await archiveProject(id, archived);
      await loadProjects();
    } catch (err) {
      setStatus(`Operation failed: ${error}`);
    }
  };

  const handleTrash = async (id: string, trashed: boolean) => {
    try {
      await trashProject(id, trashed);
      await loadProjects();
    } catch (err) {
      setStatus(`Operation failed: ${error}`);
    }
  };

  const handlePermanentDelete = async (id: string, name: string) => {
    if (!window.confirm(`Permanently delete project ${name}? This cannot be undone.`)) return;
    try {
      await permanentDeleteProject(id);
      await loadProjects();
    } catch (err) {
      setStatus(`Delete failed: ${error}`);
    }
  };

  const handleEmptyTrash = async () => {
    if (!window.confirm('Empty trash? All projects will be permanently deleted.')) return;
    const trashItems = projects.filter((p) => p.trashed);
    for (const p of trashItems) {
      try { await permanentDeleteProject(p.id); } catch {}
    }
    await loadProjects();
  };

  const handleAddTag = async (id: string, tag: string) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const tags = [...new Set([...(proj.tags || []), tag])];
    try {
      await updateProjectTags(id, tags);
      await loadProjects();
    } catch (err) {
      setStatus(`Operation failed: ${error}`);
    }
  };

  const handleRemoveTag = async (id: string, tag: string) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const tags = (proj.tags || []).filter((t) => t !== tag);
    try {
      await updateProjectTags(id, tags);
      await loadProjects();
    } catch (err) {
      setStatus(`Operation failed: ${error}`);
    }
  };

  const handleCreateFromTemplate = async (tplId: string) => {
    const tpl = templates.find((t) => t.id === tplId);
    const name = createName.trim() || tpl?.label || 'Untitled';
    try {
      const created = await createProject({ name, template: tplId });
      setTemplateGalleryOpen(false);
      setCreateName('');
      await loadProjects();
      navigate(`/editor/${created.id}`);
    } catch (err) {
      setStatus(`Create failed: ${error}`);
    }
  };

  const handleUploadTemplate = async (file: File) => {
    const baseName = file.name.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const templateId = baseName.toLowerCase();
    const templateLabel = baseName;
    setUploadingTemplate(true);
    try {
      await uploadTemplate(templateId, templateLabel, file);
      const res = await listTemplates();
      setTemplates(res.templates || []);
      setCategories(res.categories || []);
      setStatus('Template uploaded successfully');
    } catch (err) {
      setStatus(`Template upload failed: ${error}`);
    } finally {
      setUploadingTemplate(false);
      if (templateZipRef.current) templateZipRef.current.value = '';
    }
  };

  const handleCopy = async (id: string, originalName: string) => {
    try {
      const res = await copyProject(id, `${originalName} (Copy)`);
      if (!res.ok || !res.project) throw new Error(res.error || 'Copy failed');
      await loadProjects();
    } catch (err) {
      setStatus(`Copy failed: ${error}`);
    }
  };

  const handleImportZip = async (file: File) => {
    setImporting(true);
    try {
      const res = await importZip({ file, projectName: file.name.replace(/\.zip$/i, '') || 'Imported Project' });
      if (!res.ok || !res.project) {
        throw new Error(res.error || 'Import failed');
      }
      setImportOpen(false);
      await loadProjects();
      navigate(`/editor/${res.project.id}`);
    } catch (err) {
      setStatus(`Zip import failed: ${error}`);
    } finally {
      setImporting(false);
    }
  };

  const handleImportArxiv = async () => {
    if (!arxivInput.trim()) {
      setStatus('Enter an arXiv URL or ID.');
      return;
    }
    setImporting(true);
    setImportProgress({ phase: 'download', percent: 0 });
    try {
      const res = await importArxivSSE(
        { arxivIdOrUrl: arxivInput.trim() },
        (prog) => setImportProgress(prog)
      );
      if (!res.ok || !res.project) {
        throw new Error(res.error || 'Import failed');
      }
      setArxivInput('');
      setImportOpen(false);
      await loadProjects();
      navigate(`/editor/${res.project.id}`);
    } catch (err) {
      setStatus(`arXiv import failed: ${error}`);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };


  const navIcons: Record<ViewFilter, React.ReactNode> = {
    all: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4.5h12M2 4.5v8a1 1 0 001 1h10a1 1 0 001-1v-8M2 4.5l1.5-2h9l1.5 2"/></svg>,
    mine: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2H4.5a1 1 0 00-1 1v10a1 1 0 001 1h7a1 1 0 001-1V5.5L9 2z"/><path d="M9 2v3.5h3.5M6 8.5h4M6 11h2.5"/></svg>,
    archived: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2.5" width="12" height="3" rx=".5"/><path d="M3 5.5v7.5a1 1 0 001 1h8a1 1 0 001-1V5.5"/><path d="M6.5 8.5h3"/></svg>,
    trash: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5h10M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5"/><path d="M4.5 4.5l.5 8.5a1 1 0 001 1h4a1 1 0 001-1l.5-8.5"/></svg>,
  };
  const navItems: { key: ViewFilter; label: string }[] = [
    { key: 'all', label: 'All Projects' },
    { key: 'mine', label: 'My Projects' },
    { key: 'archived', label: 'Archived' },
    { key: 'trash', label: 'Trash' },
  ];

  return (
    <div className="project-shell">
      {/* ── Sidebar ── */}
      <aside className="project-sidebar">
        <div className="sidebar-brand">
          <div className="brand-title">Manuscripta</div>
          <div className="brand-sub">{'Projects Workspace'}</div>
        </div>

        <button className="sidebar-create-btn" onClick={() => setCreateOpen(true)}>
          + {'New project'}
        </button>
        <div className="sidebar-actions-row">
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => setImportOpen(true)}>{'Import project'}</button>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => setTemplateGalleryOpen(true)}>{'Templates'}</button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <div
              key={item.key}
              className={`sidebar-nav-item${viewFilter === item.key && !activeTag ? ' active' : ''}`}
              onClick={() => { setViewFilter(item.key); setActiveTag(null); }}
            >
              <span className="sidebar-nav-icon">{navIcons[item.key]}</span>
              <span className="sidebar-nav-label">{item.label}</span>
              <span className="sidebar-nav-count">{viewCounts[item.key]}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-tags-section">
          <div className="sidebar-tags-header" onClick={() => setTagsExpanded(!tagsExpanded)}>
            <span>{tagsExpanded ? '\u25BE' : '\u25B8'} {'Tags'}</span>
          </div>
          {tagsExpanded && (
            <div className="sidebar-tags-list">
              {allTags.map((tag) => (
                <div
                  key={tag}
                  className={`sidebar-tag-item${activeTag === tag ? ' active' : ''}`}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                >
                  <span className="tag-dot" />
                  <span>{tag}</span>
                </div>
              ))}
              {addingSidebarTag ? (
                <input
                  className="sidebar-tag-input"
                  autoFocus
                  value={newSidebarTag}
                  onChange={(e) => setNewSidebarTag(e.target.value)}
                  placeholder={'Enter tag name'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSidebarTag.trim()) {
                      setAddingSidebarTag(false);
                      setNewSidebarTag('');
                    }
                    if (e.key === 'Escape') { setAddingSidebarTag(false); setNewSidebarTag(''); }
                  }}
                  onBlur={() => { setAddingSidebarTag(false); setNewSidebarTag(''); }}
                />
              ) : (
                <div className="sidebar-new-tag-btn" onClick={() => setAddingSidebarTag(true)}>
                  + {'New Tag'}
                </div>
              )}
            </div>
          )}
        </div>

        {authEnabled && user && (
          <div className="sidebar-auth-footer">
            <div className="sidebar-auth-user">{user.displayName || user.username}</div>
            <button className="btn ghost" onClick={logout} style={{ fontSize: 12, padding: '4px 10px' }}>
              {'Sign Out'}
            </button>
          </div>
        )}
      </aside>

      {/* ── Main Content ── */}
      <div className="project-main">
        <header className="project-main-header">
          <h1 className="project-main-title">
            {activeTag ? `${'Tags'}: ${activeTag}` : navItems.find((n) => n.key === viewFilter)?.label || 'All Projects'}
          </h1>
          <div className="project-main-header-actions">
            {viewFilter === 'trash' && viewCounts.trash > 0 && (
              <button className="btn ghost" onClick={handleEmptyTrash}>{'Empty Trash'}</button>
            )}
            <button className="btn ghost" onClick={() => setSettingsOpen(true)}>{'Settings'}</button>
          </div>
        </header>

        {status && <div className="status-bar"><div>{status}</div></div>}

        <div className="project-toolbar">
          <input
            className="project-search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={'Search projects...'}
          />
          <div className="ios-select-wrapper">
            <button className="ios-select-trigger" onClick={() => setSortDropdownOpen(!sortDropdownOpen)}>
              <span>{sortBy === 'updatedAt' ? 'Recently Modified' : sortBy === 'name' ? 'By Name' : 'Created'}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={sortDropdownOpen ? 'rotate' : ''}>
                <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {sortDropdownOpen && (
              <div className="ios-dropdown dropdown-down">
                {([['updatedAt', 'Recently Modified'], ['name', 'By Name'], ['createdAt', 'Created']] as [SortBy, string][]).map(([val, label]) => (
                  <div key={val} className={`ios-dropdown-item ${sortBy === val ? 'active' : ''}`} onClick={() => { setSortBy(val); setSortDropdownOpen(false); }}>
                    {label}
                    {sortBy === val && (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Project Table ── */}
        <div className="project-table-wrapper">
          <table className="project-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={filteredProjects.length > 0 && selectedIds.size === filteredProjects.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(filteredProjects.map((p) => p.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
                <th className="col-name">{'Name'}</th>
                <th className="col-tags">{'Tags'}</th>
                <th className="col-modified">{'Last Modified'}</th>
                <th className="col-actions">{'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => (
                <tr key={project.id} className={`project-table-row${selectedIds.has(project.id) ? ' selected' : ''}`}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(project.id)}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(project.id); else next.delete(project.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                  <td className="col-name">
                    {renameState?.id === project.id ? (
                      <input
                        className="inline-input"
                        autoFocus
                        value={renameState.value}
                        onChange={(e) => setRenameState({ ...renameState, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleRename(); }
                          if (e.key === 'Escape') { e.preventDefault(); setRenameState(null); }
                        }}
                        onBlur={() => setRenameState(null)}
                      />
                    ) : (
                      <span className="project-name-link" onClick={() => navigate(`/editor/${project.id}`)}>
                        {project.name}
                      </span>
                    )}
                  </td>
                  <td className="col-tags">
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {(project.tags || []).map((tag) => (
                        <span key={tag} className="project-tag-pill" onClick={() => setActiveTag(tag)}>
                          {tag}
                          {viewFilter !== 'trash' && (
                            <span style={{ marginLeft: 4, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleRemoveTag(project.id, tag); }}>&times;</span>
                          )}
                        </span>
                      ))}
                      {viewFilter !== 'trash' && (
                        tagEditId === project.id ? (
                          <input
                            className="sidebar-tag-input"
                            style={{ width: 80, fontSize: 12 }}
                            autoFocus
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            placeholder={'Add Tag'}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && tagInput.trim()) {
                                handleAddTag(project.id, tagInput.trim());
                                setTagInput('');
                                setTagEditId(null);
                              }
                              if (e.key === 'Escape') { setTagEditId(null); setTagInput(''); }
                            }}
                            onBlur={() => { setTagEditId(null); setTagInput(''); }}
                          />
                        ) : (
                          <span
                            className="project-tag-pill"
                            style={{ cursor: 'pointer', opacity: 0.5 }}
                            onClick={() => { setTagEditId(project.id); setTagInput(''); }}
                          >+</span>
                        )
                      )}
                    </div>
                  </td>
                  <td className="col-modified">
                    {formatRelativeTime(project.updatedAt || project.createdAt, t)}
                  </td>
                  <td className="col-actions">
                    <div className="col-actions-inner">
                      {viewFilter === 'trash' ? (<>
                        <button className="btn ghost" onClick={() => handleTrash(project.id, false)}>{'Restore'}</button>
                        <button className="btn ghost" onClick={() => handlePermanentDelete(project.id, project.name)}>{'Delete Permanently'}</button>
                      </>) : (<>
                        <button className="btn ghost" onClick={() => navigate(`/editor/${project.id}`)}>{'Open'}</button>
                        <button className="btn ghost" onClick={() => setRenameState({ id: project.id, value: project.name })}>{'Rename'}</button>
                        <button className="btn ghost" onClick={() => handleCopy(project.id, project.name)}>{'Copy'}</button>
                        <button className="btn ghost" onClick={() => { setTransferSource({ id: project.id, name: project.name }); setTransferOpen(true); }}>{'Transfer'}</button>
                        {project.archived
                          ? <button className="btn ghost" onClick={() => handleArchive(project.id, false)}>{'Unarchive'}</button>
                          : <button className="btn ghost" onClick={() => handleArchive(project.id, true)}>{'Archive'}</button>
                        }
                        <button className="btn ghost" onClick={() => handleDelete(project.id, project.name)}>{'Delete'}</button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProjects.length === 0 && (
            <div className="project-table-empty">{'No projects.'}</div>
          )}
        </div>

        <div className="project-footer">
          {`Showing ${shown} / ${total} projects`}
        </div>
      </div>

      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleImportZip(file);
          }
          if (event.target) {
            event.target.value = '';
          }
        }}
      />

      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>{'New project'}</div>
              <button className="icon-btn" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>{'Project name'}</label>
                <input
                  className="input"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder={'My Paper'}
                />
              </div>
              <div className="field">
                <label>{'Template'}</label>
                <div className="ios-select-wrapper">
                  <button className="ios-select-trigger" onClick={() => setTemplateDropdownOpen(!templateDropdownOpen)}>
                    <span>{templates.find((tpl) => tpl.id === createTemplate)?.label || '—'}</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={templateDropdownOpen ? 'rotate' : ''}>
                      <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {templateDropdownOpen && (
                    <div className="ios-dropdown dropdown-down">
                      {templates.map((tpl) => (
                        <div key={tpl.id} className={`ios-dropdown-item ${createTemplate === tpl.id ? 'active' : ''}`} onClick={() => { setCreateTemplate(tpl.id); setTemplateDropdownOpen(false); }}>
                          {tpl.label}
                          {createTemplate === tpl.id && (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setCreateOpen(false)}>{'Cancel'}</button>
              <button className="btn" onClick={handleCreate}>{'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>{'Import project'}</div>
              <button className="icon-btn" onClick={() => setImportOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>{'Upload Zip file'}</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="btn"
                    onClick={() => zipInputRef.current?.click()}
                    disabled={importing}
                  >
                    {'Choose file'}
                  </button>
                  {importing && <span className="muted">{'Importing...'}</span>}
                </div>
              </div>
              <div className="field" style={{ borderTop: '1px solid var(--border, #e0e0e0)', paddingTop: '12px', marginTop: '4px' }}>
                <label>{'Import via arXiv link'}</label>
                <input
                  className="input"
                  value={arxivInput}
                  onChange={(event) => setArxivInput(event.target.value)}
                  placeholder={'arXiv URL or ID, e.g. 2301.00001'}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleImportArxiv();
                    }
                  }}
                />
              </div>
              {importProgress && (
                <div className="field" style={{ paddingTop: '8px' }}>
                  <label>
                    {importProgress.phase === 'download'
                      ? importProgress.percent >= 0
                        ? `Downloading... ${percent}%`
                        : 'Downloading...'
                      : 'Extracting...'}
                  </label>
                  <div style={{
                    width: '100%',
                    height: '6px',
                    background: 'var(--border, #e0e0e0)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    marginTop: '4px'
                  }}>
                    <div style={{
                      width: importProgress.percent >= 0 ? `${importProgress.percent}%` : '100%',
                      height: '100%',
                      background: 'var(--accent, #4a90d9)',
                      borderRadius: '3px',
                      transition: 'width 0.3s ease',
                      animation: importProgress.percent < 0 ? 'indeterminate 1.5s infinite linear' : undefined
                    }} />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setImportOpen(false)}>{'Cancel'}</button>
              <button className="btn" onClick={handleImportArxiv} disabled={importing || !arxivInput.trim()}>
                {'Import arXiv'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Template Gallery Modal ── */}
      {templateGalleryOpen && (
        <div className="modal-backdrop" onClick={() => setTemplateGalleryOpen(false)}>
          <div className="modal template-gallery-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="template-gallery-header-left">
                <button className="btn ghost" onClick={() => setTemplateGalleryOpen(false)}>{'Back'}</button>
                <span>{'Templates'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  ref={templateZipRef}
                  type="file"
                  accept=".zip"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadTemplate(f);
                  }}
                />
                <button
                  className="btn ghost"
                  disabled={uploadingTemplate}
                  onClick={() => templateZipRef.current?.click()}
                >
                  {uploadingTemplate ? 'Uploading...' : 'Upload Template'}
                </button>
                <button className="icon-btn" onClick={() => setTemplateGalleryOpen(false)}>✕</button>
              </div>
            </div>
            <div className="modal-body">
              <div className="template-gallery-subtitle">{'Choose a template to start your project'}</div>

              <div className="template-gallery-categories">
                {[{ id: 'all', label: 'All', labelEn: 'All' }, ...(categories || [])].map((cat) => (
                  <button
                    key={cat.id}
                    className={`template-cat-tab${galleryCat === cat.id ? ' active' : ''}`}
                    onClick={() => setGalleryCat(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="template-gallery-filters">
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input type="checkbox" checked={galleryFeatured} onChange={(e) => setGalleryFeatured(e.target.checked)} />
                  {'Featured'}
                </label>
                <input
                  className="project-search"
                  value={gallerySearch}
                  onChange={(e) => setGallerySearch(e.target.value)}
                  placeholder={'Search templates...'}
                  style={{ maxWidth: 240 }}
                />
              </div>

              <div className="template-gallery-grid">
                {galleryTemplates.map((tpl) => (
                  <div key={tpl.id} className="template-card" onClick={() => handleCreateFromTemplate(tpl.id)}>
                    <div className="template-card-thumb">
                      {tpl.featured && <span className="template-card-badge">Featured</span>}
                    </div>
                    <div className="template-card-body">
                      <div className="template-card-title">{tpl.label}</div>
                      <div className="template-card-desc">
                        {tpl.description}
                      </div>
                      {tpl.tags?.length > 0 && (
                        <div className="template-card-tags">
                          {tpl.tags.map((tag) => <span key={tag} className="project-tag-pill">{tag}</span>)}
                        </div>
                      )}
                      {tpl.author && <div className="template-card-author">{tpl.author}</div>}
                    </div>
                  </div>
                ))}
              </div>
              {galleryTemplates.length === 0 && (
                <div className="template-gallery-empty">{'No matching templates'}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {transferOpen && transferSource && (
        <div className="modal-backdrop" onClick={() => setTransferOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>{'Template Transfer'} — {transferSource.name}</div>
              <button className="icon-btn" onClick={() => setTransferOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <TransferPanel
                projectId={transferSource.id}
                onJobUpdate={(job) => {
                  setActiveJob({ ...job, sourceName: transferSource.name });
                  setJobWidgetOpen(true);
                  if (job.status === 'success') loadProjects();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating transfer progress widget */}
      {activeJob && !transferOpen && jobWidgetOpen && (
        <div className="transfer-widget">
          <div className="transfer-widget-header">
            <span>{'Template Transfer'} — {activeJob.sourceName || ''}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="icon-btn" onClick={() => {
                setTransferOpen(true);
                if (transferSource) setTransferSource(transferSource);
              }} title={'Expand'}>&#x2197;</button>
              <button className="icon-btn" onClick={() => setJobWidgetOpen(false)}>✕</button>
            </div>
          </div>
          <div className="transfer-widget-status">
            <strong>{'Status'}:</strong> {activeJob.status}
          </div>
          {activeJob.error && (
            <div className="transfer-widget-error">{activeJob.error}</div>
          )}
          {activeJob.progressLog.length > 0 && (
            <div className="transfer-widget-log">
              {activeJob.progressLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>{'Settings'}</div>
              <button className="icon-btn" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>{'LLM Endpoint'}</label>
                <input
                  className="input"
                  type="text"
                  placeholder="https://api.openai.com/v1/chat/completions"
                  value={settingsForm.llmEndpoint}
                  onChange={(e) => setSettingsForm((p) => ({ ...p, llmEndpoint: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>{'LLM API Key'}</label>
                <input
                  className="input"
                  type="password"
                  placeholder="sk-..."
                  value={settingsForm.llmApiKey}
                  onChange={(e) => setSettingsForm((p) => ({ ...p, llmApiKey: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>{'LLM Model'}</label>
                <input
                  className="input"
                  type="text"
                  placeholder="gpt-4o"
                  value={settingsForm.llmModel}
                  onChange={(e) => setSettingsForm((p) => ({ ...p, llmModel: e.target.value }))}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {'If API Key is empty, backend env vars will be used.'}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => { setSettingsForm(loadLLMSettings()); setSettingsOpen(false); }}>{'Cancel'}</button>
              <button className="btn" onClick={() => { saveLLMSettings(settingsForm); setSettingsOpen(false); }}>{'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
