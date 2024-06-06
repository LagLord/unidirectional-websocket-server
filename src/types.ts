import { ChangeStream, ChangeStreamInsertDocument } from "mongodb";
import WebSocket, { WebSocketServer, } from 'ws';

export interface ChatMessage {
    userId: string;
    msg: string;
    roomId?: string;
    ts: number;

    displayName?: string;
    imageUrl?: string;
    description?: string
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
    pinger?: NodeJS.Timeout;
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
    description: string;
}

export interface ConnectedUserObj extends Partial<StoredUserObject> {
    roomId?: string;
    connectedAtTs?: number;
    socket?: ActiveWebsocket;
    bannedUntilTS?: number;
    rateLimitLeft?: number;
}

export interface RoomObj {
    roomName: string;
    userCount: number;
    userWSHead?: ActiveWebsocket;
    private?: boolean;
    userIdsAllowed?: string[];
}