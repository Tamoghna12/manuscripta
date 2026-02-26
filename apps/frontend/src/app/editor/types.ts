export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface WebsearchItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  bibtex: string;
  citeKey: string;
}

export interface PendingChange {
  filePath: string;
  original: string;
  proposed: string;
  diff: string;
}

export type InlineEdit =
  | { kind: 'new-file' | 'new-folder'; parent: string; value: string }
  | { kind: 'rename'; path: string; value: string };

export type RightView = 'pdf' | 'toc' | 'figures' | 'diff' | 'log' | 'review';
export type SidebarTab = 'files' | 'collab' | 'agent' | 'vision' | 'search' | 'websearch' | 'plot' | 'review' | 'references' | 'zotero' | 'mendeley' | 'git' | 'comments' | 'trackchanges';
export type AssistantMode = 'chat' | 'agent';
