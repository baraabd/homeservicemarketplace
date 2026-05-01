// Chat contracts (Sprint 3, slice 3.3). REST surface only —
// WebSocket / push / attachments / voice channels are explicitly out
// of scope and are NOT exported from this barrel.
export * from './enums/conversation-participant-role';
export * from './request/create-conversation.request';
export * from './request/send-message.request';
export * from './response/conversation-list.response';
export * from './response/conversation-summary';
export * from './response/create-conversation.response';
export * from './response/mark-conversation-read.response';
export * from './response/message-list.response';
export * from './response/message-summary';
export * from './response/send-message.response';
