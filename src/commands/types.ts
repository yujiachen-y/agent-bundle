export type Command = {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  sourcePath: string;
};
