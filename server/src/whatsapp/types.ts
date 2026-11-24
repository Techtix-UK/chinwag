import type wwebjs from 'whatsapp-web.js';

export type WaClient = wwebjs.Client;
export type WaMessage = wwebjs.Message;
export type WaChat = wwebjs.Chat;
export type WaGroupChat = wwebjs.GroupChat;
export type WaContact = wwebjs.Contact;

export interface ClientFactoryOptions {
  accountId: string;
  clientId: string;
  dataPath: string;
}

/** Abstraction over whatsapp-web.js client creation so tests can provide a mock. */
export type ClientFactory = (opts: ClientFactoryOptions) => WaClient;
