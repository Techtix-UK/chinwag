import type { Principal } from '../services/permissions.js';
declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      requestId?: string;
    }
  }
}
export {};
