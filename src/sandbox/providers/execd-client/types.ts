export type CommandRunResponse = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type FileReadResponse = {
  content: string;
};

export type FileListResponse = {
  entries: Array<string | { name?: string; path?: string; type?: string }>;
};
