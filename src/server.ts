'use server';

import { MongoClient } from "mongodb";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { WebSocketServer, } from 'ws';
import {
    ActiveWebsocket,
    ChangeStreamInsertDoc,
    ChatMessage,
    CustomContext
} from './types';
import util from 'util';
import { BACKLOG_CONNECTIONS, CHANGE_STREAM_LOOP_MS, CHAT_COLLECTION, PAYLOAD_SIZE_BYTES, RATE_LIMIT_HALF_MIN } from "./constants";

//@ts-ignore
const deployment: 'prod' | 'dev' = process.env.DEPLOYMENT!;
const uri = process.env.MONGODB_URL!;
const dbName = process.env.DB_NAME!;
const colName = CHAT_COLLECTION;
console.log(dbName, colName);



export const simulateAsyncPause = (t: number) =>
    new Promise(resolve => {
        setTimeout(() => resolve(''), t);
    });

export async function setupMongoChangeStream(
    context: CustomContext,
) {
    const client = new MongoClient(uri,);
    try {
        const database = client.db(dbName);
        const chat_server = database.collection<ChatMessage>(colName);
        // Open a Change Stream on the "haikus" collection
        context.cs = chat_server.watch();

        // Set up a change stream listener when change events are emitted
        context.cs.on("change", next => {
            // Print any change event
            console.log("received a change to the collection: \t", next);
            if (next.operationType === 'insert' && next.ns.coll === colName) {
                const data = (next as ChangeStreamInsertDoc).fullDocument;
                const user = context.userMap[data.userId];
                if (data.roomId)
                    var room = context.roomMap['__global__'];
                else
                    var room = context.roomMap[data.roomId!];
                const chatMessage: ChatMessage = {
                    msg: data.msg,
                    roomId: data.roomId,
                    ts: data.ts,
                    userId: data.userId,
                    description: user?.description,
                    displayName: user?.displayName,
                    imageUrl: user?.profilePicture,
                }

                let currentClient: ActiveWebsocket | undefined = room.userWSHead;
                while (currentClient) {
                    // @ts-ignore
                    console.log('clientAlive:', currentClient.isAlive)

                    currentClient.send(JSON.stringify(chatMessage), (error) => {
                        console.log('Faield to send message:', error);
                    })
                    currentClient = currentClient.nextClientInRoom;
                }
            }
        });

        // Pause before inserting a document
        await simulateAsyncPause(1000);

        // Insert a new document into the collection
        await chat_server.insertOne({
            // displayName: "Shriveled Datum",
            userId: '123243535',
            roomId: 'Global',
            msg: "No bytes, no problem. Just insert a document, in MongoDB",
            // imageUrl: 'https://imagedelivery.net/9i0Mt_dC7lopRIG36ZQvKw/XScape%20Legends%20Card%20Assassin.png/w=200',
            ts: Date.now(),
        });

        while (true) {

            const t = Date.now()
            console.log('changeStream running...', t)
            await simulateAsyncPause(CHANGE_STREAM_LOOP_MS);
            console.log('changeStream running...', t)
            if (context.cs.closed) {
                return setupMongoChangeStream(context);
            }
        }
        // await context.close()
        // console.log('changeStream closing...', Date.now())
    } finally {
        // Close the database connection on completion or error
        await client.close();
    }
}

export async function startServer(
    context: CustomContext,
) {
    context.wss = new WebSocketServer({
        // port: 8080,
        noServer: true,
        backlog: BACKLOG_CONNECTIONS,
        maxPayload: PAYLOAD_SIZE_BYTES,

    });
    context.pinger = setupPinging(context);
    setupWebsocketListeners(context);
}

export async function setupWebsocketListeners(
    context: CustomContext,
) {
    if (context.wss) {
        context.wss.on('connection', function connection(ws: ActiveWebsocket, request, ...args: string[]) {
            let ipAddr = '';
            if (deployment === 'prod') {
                ipAddr = request.headers['x-forwarded-for']
                    ? (request.headers['x-forwarded-for'] as string).split(',')[0].trim()
                    : request.socket.remoteAddress || '';
                console.log(`Received connection from ${request.socket.remoteAddress}:`)
                console.log(util.inspect(request.headers, { showHidden: false, depth: null, colors: true }));
            } else {
                ipAddr = request.socket.remoteAddress || '';
                console.log(`Received connection from ${ipAddr}:`)
                console.log(util.inspect(request.headers, { showHidden: false, depth: null, colors: true }));
            }
            // Create Room link
            const room = context.roomMap[args[0]]
            if (room.userWSHead) {
                room.userWSHead.prevClientInRoom = ws
                ws.nextClientInRoom = room.userWSHead;
            }
            room.userWSHead = ws;
            room.userCount += 1;

            // Create User link
            if (!context.userMap[args[1]]) {
                context.userMap[args[1]]!.socket?.close()
                context.userMap[args[1]]!.socket = ws
            } else {
                context.userMap[args[1]] = {
                    connectedAtTs: Date.now(),
                    rateLimitLeft: RATE_LIMIT_HALF_MIN,
                    roomId: args[0],
                };
            }
            ws.userObj = context.userMap[args[1]];

            ws.isAlive = true;
            ws.on('error', console.error);
            ws.on('close', (code, reason) => {
                // Clean up a few things here
                const userObj = ws.userObj!;
                userObj.socket = undefined;
                const room = context.roomMap[userObj.roomId!];
                if (room.userWSHead === ws)
                    room.userWSHead = ws.nextClientInRoom;
                else {
                    ws.prevClientInRoom!.nextClientInRoom = ws.nextClientInRoom;
                    if (ws.nextClientInRoom)
                        ws.nextClientInRoom.prevClientInRoom = ws.prevClientInRoom;
                }

            });
            ws.on('pong', (ws: ActiveWebsocket, buffer: Buffer) => {
                ws.isAlive = true;
            });
        });


        context.wss.on('close', async function close() {
            try {
                context.wss!.removeAllListeners()
            } catch (e) { }
            console.log('closed')
            if (context.pinger)
                clearInterval(context.pinger);

            try {
                // await context.cs.close();
                // console.log("closed changeStream")
                // await simulateAsyncPause(4000);
                await startServer(context)
            } catch (e) {
                console.log('ERROR inside close():', e)
            }


        });


    }
}

export function setupPinging(changeStreamWS: CustomContext) {
    const interval = setInterval(function ping() {
        console.log('pinging ', Date.now())
        if (changeStreamWS.wss) {
            changeStreamWS.wss.clients.forEach(function each(ws) {
                const activeWs = ws as ActiveWebsocket;
                if (!activeWs.isAlive) return activeWs.close();

                activeWs.isAlive = false;
                activeWs.ping();
            });
            changeStreamWS.wss!.close()
        } else
            console.log('pinging failed WSS not running');

        // interval.refresh()
    }, 20000);
    return interval;
}