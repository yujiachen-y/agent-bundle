export type EnvRestore = () => void;

export function withTemporaryEnv(updates: Record<string, string | undefined>): EnvRestore {
  const previousValues = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  );

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  return () => {
    Object.entries(previousValues).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  };
}
