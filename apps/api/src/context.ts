import type { StsAdapter } from '@tronic/core';
import type { Config } from './config';
import type { Db } from './db';

export interface AppContext {
  cfg: Config;
  db: Db;
  adapter: StsAdapter;
}
