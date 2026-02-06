import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createProject,
  deleteProject,
  importArxiv,
  importZip,
  listProjects,
  listTemplates,
  renameProject,
  convertTemplate
} from '../api/client';

export default function ProjectPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<{ id: string; name: string; createdAt: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; label: string; mainFile: string }[]>([]);
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTemplate, setCreateTemplate] = useState('');
  const [renameState, setRenameState] = useState<{ id: string; value: string } | null>(null);
  const [arxivInput, setArxivInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [templateMap, setTemplateMap] = useState<Record<string, string>>({});
  const [mainFileMap, setMainFileMap] = useState<Record<string, string>>({});
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const loadProjects = useCallback(async () => {
    const res = await listProjects();
    setProjects(res.projects || []);
  }, []);

  useEffect(() => {
    loadProjects().catch((err) => setStatus(`加载项目失败: ${String(err)}`));
  }, [loadProjects]);

  useEffect(() => {
    listTemplates()
      .then((res) => {
        setTemplates(res.templates || []);
        if (res.templates?.length && !createTemplate) {
          setCreateTemplate(res.templates[0].id);
        }
      })
      .catch((err) => setStatus(`模板加载失败: ${String(err)}`));
  }, [createTemplate]);

  const filteredProjects = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((item) => item.name.toLowerCase().includes(term));
  }, [filter, projects]);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) {
      setStatus('请输入项目名称。');
      return;
    }
    try {
      const created = await createProject({ name, template: createTemplate || undefined });
      setCreateOpen(false);
      setCreateName('');
      await loadProjects();
      navigate(`/editor/${created.id}`);
    } catch (err) {
      setStatus(`创建失败: ${String(err)}`);
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
      setStatus(`重命名失败: ${String(err)}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`删除项目 ${name}？此操作不可撤销。`)) return;
    try {
      await deleteProject(id);
      await loadProjects();
    } catch (err) {
      setStatus(`删除失败: ${String(err)}`);
    }
  };

  const handleImportZip = async (file: File) => {
    setImporting(true);
    try {
      const res = await importZip({ file, projectName: file.name.replace(/\.zip$/i, '') || 'Imported Project' });
      if (!res.ok || !res.project) {
        throw new Error(res.error || '导入失败');
      }
      await loadProjects();
      navigate(`/editor/${res.project.id}`);
    } catch (err) {
      setStatus(`Zip 导入失败: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleImportArxiv = async () => {
    if (!arxivInput.trim()) {
      setStatus('请输入 arXiv URL 或 ID。');
      return;
    }
    setImporting(true);
    try {
      const res = await importArxiv({ arxivIdOrUrl: arxivInput.trim() });
      if (!res.ok || !res.project) {
        throw new Error(res.error || '导入失败');
      }
      setArxivInput('');
      await loadProjects();
      navigate(`/editor/${res.project.id}`);
    } catch (err) {
      setStatus(`arXiv 导入失败: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleConvertTemplate = async (projectId: string) => {
    const templateId = templateMap[projectId] || templates[0]?.id;
    if (!templateId) {
      setStatus('暂无模板可用。');
      return;
    }
    const mainFile = mainFileMap[projectId] || 'main.tex';
    setStatus('正在转换模板...');
    try {
      const res = await convertTemplate({ projectId, targetTemplate: templateId, mainFile });
      if (!res.ok) {
        throw new Error(res.error || '模板转换失败');
      }
      setStatus(`模板已切换为 ${templateId}`);
    } catch (err) {
      setStatus(`模板转换失败: ${String(err)}`);
    }
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-title">OpenPrism</div>
          <div className="brand-sub">Projects Workspace</div>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => setCreateOpen(true)}>新建项目</button>
          <button
            className="btn ghost"
            onClick={() => zipInputRef.current?.click()}
            disabled={importing}
          >
            上传 Zip
          </button>
          <div className="inline-field">
            <input
              className="input"
              value={arxivInput}
              onChange={(event) => setArxivInput(event.target.value)}
              placeholder="arXiv URL / ID"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleImportArxiv();
                }
              }}
            />
            <button className="btn ghost" onClick={handleImportArxiv} disabled={importing}>导入 arXiv</button>
          </div>
        </div>
      </header>

      <div className="status-bar">
        <div>{status}</div>
      </div>

      <main className="project-page">
        <div className="panel-search">
          <input
            className="input"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="搜索项目..."
          />
        </div>
        <div className="project-grid">
          {filteredProjects.map((project) => (
            <div key={project.id} className="project-card">
              {renameState?.id === project.id ? (
                <input
                  className="inline-input"
                  autoFocus
                  value={renameState.value}
                  onChange={(event) => setRenameState({ ...renameState, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleRename();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setRenameState(null);
                    }
                  }}
                  onBlur={() => setRenameState(null)}
                />
              ) : (
                <div className="project-title">{project.name}</div>
              )}
              <div className="project-meta">{new Date(project.createdAt).toLocaleString()}</div>
              <div className="project-actions">
                <button className="btn" onClick={() => navigate(`/editor/${project.id}`)}>打开</button>
                <button className="btn ghost" onClick={() => setRenameState({ id: project.id, value: project.name })}>重命名</button>
                <button className="btn ghost" onClick={() => handleDelete(project.id, project.name)}>删除</button>
              </div>
              <div className="project-convert">
                <select
                  className="select"
                  value={templateMap[project.id] || templates[0]?.id || ''}
                  onChange={(event) => setTemplateMap((prev) => ({ ...prev, [project.id]: event.target.value }))}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                  ))}
                </select>
                <input
                  className="input"
                  value={mainFileMap[project.id] || 'main.tex'}
                  onChange={(event) => setMainFileMap((prev) => ({ ...prev, [project.id]: event.target.value }))}
                  placeholder="main.tex"
                />
                <button className="btn ghost" onClick={() => handleConvertTemplate(project.id)}>转换模板</button>
              </div>
            </div>
          ))}
          {filteredProjects.length === 0 && (
            <div className="muted">暂无项目。</div>
          )}
        </div>
      </main>

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
              <div>新建项目</div>
              <button className="icon-btn" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>项目名称</label>
                <input
                  className="input"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="My Paper"
                />
              </div>
              <div className="field">
                <label>模板</label>
                <select
                  className="select"
                  value={createTemplate}
                  onChange={(event) => setCreateTemplate(event.target.value)}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setCreateOpen(false)}>取消</button>
              <button className="btn" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
