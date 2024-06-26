import type { ChangeStream, ChangeStreamInsertDocument } from "mongodb";
import WebSocket, { WebSocketServer, } from 'ws';
import http from 'http';

export interface ChatMessage {
    userId: string;
    msg: string;
    roomId?: string;
    ts: number;

    displayName?: string;
    imageUrl?: string;
    bio?: string
};

export interface ActiveWebsocket extends WebSocket {
    isAlive: boolean;
    prevClientInRoom?: ActiveWebsocket;
    nextClientInRoom?: ActiveWebsocket;
    userObj?: ConnectedUserObj;
};

export interface CustomContext {
    cs: ChangeStream | null;
    wss: WebSocketServer | null;
    pinger?: ReturnType<typeof setTimeout>;
    roomMap: {
        [key: string]: RoomObj;
    };
    userMap: {
        [key: string]: ConnectedUserObj;
    };
};

export type ChangeStreamInsertDoc = ChangeStreamInsertDocument<ChatMessage>;

export type StoredUserObject = {
    displayName: string;
    profilePicture: string;
    bio: string;
}

export interface ConnectedUserObj extends Partial<StoredUserObject> {
    roomId?: string;
    connectedAtTs?: number;
    client?: ActiveWebsocket;
    bannedUntilTS?: number;
    rateLimitLeft?: number;
}

export interface CircularArray {
    buffer: Array<Buffer>;
    head: number;
}

export interface RoomObj {
    roomName: string;
    userCount: number;
    userWSHead?: ActiveWebsocket;
    private?: boolean;
    userIdsAllowed?: string[];
    newMessages: CircularArray;
}

export interface ServerHeaders extends http.IncomingHttpHeaders {
    userid?: string;
    roomid?: string;
}