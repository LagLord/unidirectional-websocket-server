import { ChangeStream } from 'mongodb';
import WebSocket, { WebSocketServer, } from 'ws';
import {
    setupWebsocketListeners,
    setupMongoChangeStream,
    simulateAsyncPause,
    ChatMessage,
    ActiveWebsocket,
    WebsocketChangeStreamHandler,
    setupPinging
} from './server';

let changeStreamWS: WebsocketChangeStreamHandler = { cs: null, wss: null };
changeStreamWS.wss = new WebSocketServer({ port: 8080 });
changeStreamWS.pinger = setupPinging(changeStreamWS)


setupWebsocketListeners(changeStreamWS)
