import { SQL } from 'bun';

let sqlClient: SQL | null = null;

const getClient = (): SQL => {
  if (sqlClient === null) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    sqlClient = new SQL({
      url,
      max: 5,
      idleTimeout: 300,
      connectionTimeout: 10,
      tls: true,
    });
  }
  return sqlClient;
};

export const sql = new Proxy((() => {}) as unknown as SQL, {
  apply(_target, _thisArg, args: unknown[]) {
    const client = getClient();
    return Reflect.apply(client as unknown as (...args: unknown[]) => unknown, client as unknown as object, args);
  },
  get(_target: unknown, property: PropertyKey, _receiver: unknown) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as unknown as SQL;
