'use server';

import { MongoClient } from "mongodb";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { WebSocketServer, } from 'ws';
import type {
    ActiveWebsocket,
    ChangeStreamInsertDoc,
    ChatMessage,
    CustomContext
} from './types';
import util from 'util';
import { BACKLOG_CONNECTIONS, CHANGE_STREAM_LOOP_MS, CHAT_COLLECTION, COMPRESSION_MIN_USER_THRESHOLD, COMPRESSION_OPTIONS, GLOBAL_SERVER_NAME, PAYLOAD_SIZE_BYTES, RATE_LIMIT_HALF_MIN } from "./constants";
import { compressMessage, getRoomMessages, pushMessage, setupChatrooms, setupUserMap } from './utils';
import zlib from 'node:zlib';

//@ts-ignore
const deployment: 'prod' | 'dev' = process.env.DEPLOYMENT!;
const uri = process.env.MONGODB_URL!;
const dbName = process.env.DB_NAME!;
const colName = CHAT_COLLECTION;
console.log(dbName, colName);
const client = new MongoClient(uri,);


export const simulateAsyncPause = (t: number) =>
    new Promise(resolve => {
        setTimeout(() => resolve(''), t);
    });

async function checkConnection() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.log('Failed to connect to MongoDB', error);
    }
}

export async function setupMongoChangeStream(
    context: CustomContext,
) {
    await checkConnection();
    try {
        const database = client.db(dbName);
        const chat_server = database.collection<ChatMessage>(colName);
        // Open a Change Stream on the "haikus" collection
        context.cs = chat_server.watch();

        // Set up a change stream listener when change events are emitted
        context.cs.on("change", async (next) => {
            // Print any change event
            console.log("received a change to the collection: \t", next);
            if (next.operationType === 'insert' && next.ns.coll === colName) {
                const data = (next as ChangeStreamInsertDoc).fullDocument;
                const user = context.userMap[data.userId];
                if (data.roomId)
                    var room = context.roomMap[data.roomId!];
                else
                    var room = context.roomMap[GLOBAL_SERVER_NAME];
                const chatMessage: ChatMessage = {
                    msg: data.msg,
                    roomId: data.roomId,
                    ts: data.ts,
                    userId: data.userId,
                    bio: user?.bio,
                    displayName: user?.displayName,
                    imageUrl: user?.profilePicture,
                }
                // Compress only when users in room > threshold
                const compress = room.userCount > COMPRESSION_MIN_USER_THRESHOLD;
                let finalBuffer: Buffer;
                if (compress) {
                    finalBuffer = compressMessage(chatMessage);
                } else {
                    const jsonString = JSON.stringify(chatMessage);
                    const buffer = Buffer.from(jsonString, 'utf-8');
                    // Set compress bit to 0 (false)
                    const metadataBuffer = Buffer.alloc(1);
                    metadataBuffer.writeUInt8(0, 0);
                    finalBuffer = Buffer.concat([buffer, metadataBuffer]);
                }
                console.log(finalBuffer)
                let currentClient: ActiveWebsocket | undefined = room.userWSHead;
                while (currentClient) {
                    // @ts-ignore
                    console.log('clientAlive:', currentClient.isAlive)

                    currentClient.send(finalBuffer, (error) => {
                        if (error) console.log('Failed to send message:', error);
                    })
                    currentClient = currentClient.nextClientInRoom;
                }
                // Add new message to roomMessages circular array
                await pushMessage(room.newMessages, finalBuffer)
            }
        });

        while (true) {
            await simulateAsyncPause(CHANGE_STREAM_LOOP_MS);
            if (context.cs.closed) {
                return setupMongoChangeStream(context);
            }
        }
        // await context.close()
        // console.log('changeStream closing...', Date.now())
    } catch (e) {
        console.log(e)
    }
    finally {
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
    await setupChatrooms(client.db(dbName), context.roomMap);
    await setupUserMap(client.db(dbName), context.userMap);
    for (const roomId in context.roomMap) {
        await getRoomMessages(client.db(dbName), roomId, context.roomMap[roomId], context.userMap);
    }
    console.log(util.inspect(context.roomMap, { showHidden: false, depth: null, colors: true }));
    console.log(util.inspect(context.userMap, { showHidden: false, depth: null, colors: true }));
}

// Async function to close a WebSocket client connection and wait until it's fully closed
async function closeWebSocketConnection(ws: ActiveWebsocket) {
    return new Promise((resolve, reject) => {
        ws.on('close', () => {
            resolve(1);
        });
        ws.close();
    });
}

export async function setupWebsocketListeners(
    context: CustomContext,
) {
    if (context.wss) {
        context.wss.on('connection', async function connection(ws: ActiveWebsocket, request, ...args: string[][]) {
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


            const [userId, roomId] = args[0];
            const userObj = context.userMap[userId];
            // Create User link
            if (userObj.client) {
                await closeWebSocketConnection(userObj!.client)
                // userObj!.client.close();
                //@ts-ignore
                // console.log('clientStatus: ', util.inspect(userObj!.client._events.close.toString(), { showHidden: false, depth: null, colors: true }))

                // while (userObj!.client) {
                //     console.log(userObj!.client?.readyState)
                //     await simulateAsyncPause(1000);
                // }
                userObj.rateLimitLeft = (userObj.rateLimitLeft ?? RATE_LIMIT_HALF_MIN) - 1
                if (userObj.rateLimitLeft < 0)
                    userObj.bannedUntilTS = Date.now() + 30 * 1000; // 30s ban for next request
            } else {
                userObj.rateLimitLeft = RATE_LIMIT_HALF_MIN - 1;
            }
            userObj!.client = ws;
            userObj!.roomId = roomId;
            userObj!.connectedAtTs = Date.now();
            ws.userObj = userObj;

            // Create Room link
            const room = context.roomMap[roomId]
            console.log(userId, roomId, room)
            if (room.userWSHead) {
                room.userWSHead.prevClientInRoom = ws
                ws.nextClientInRoom = room.userWSHead;
            }
            room.userWSHead = ws;
            room.userCount += 1;

            ws.isAlive = true;
            ws.send(JSON.stringify(room.newMessages),);
            ws.on('error', console.error);
            ws.on('close', (code, reason) => {
                // Clean up a few things here
                console.log('clientCLosed', code, reason)
                const userObj = ws.userObj!;
                const room = context.roomMap[userObj.roomId!];
                room.userCount -= 1;
                if (room.userWSHead === ws) {
                    room.userWSHead = ws.nextClientInRoom;
                    if (room.userWSHead)
                        room.userWSHead.prevClientInRoom = undefined;
                }
                else {
                    ws.prevClientInRoom!.nextClientInRoom = ws.nextClientInRoom;
                    if (ws.nextClientInRoom)
                        ws.nextClientInRoom.prevClientInRoom = ws.prevClientInRoom;
                }
                userObj.client = undefined;
            });
            ws.on('pong', (_: ActiveWebsocket, buffer: Buffer) => {
                ws.isAlive = true;
                console.log('pongReceived:', Date.now())
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
                if (!activeWs.isAlive) {
                    console.log('Inactive client closing')
                    activeWs.close();
                    return;
                };

                activeWs.isAlive = false;
                activeWs.ping('ping');
                // Also increase ratelimit counter
                activeWs.userObj!.rateLimitLeft = Math.min(
                    RATE_LIMIT_HALF_MIN,
                    activeWs.userObj!.rateLimitLeft! + RATE_LIMIT_HALF_MIN
                )
                console.log(`WS size : ${getObjectSize(activeWs)}`)
            });

            console.log(`
ActiveConnections: ${changeStreamWS.wss.clients.size}\n
UserMap len: ${Object.values(changeStreamWS.userMap).filter(i => i.client).length}\n
RoomMap ${util.inspect(changeStreamWS.roomMap, { showHidden: false, depth: 3, colors: true })}`)
            // changeStreamWS.wss!.close()
        } else
            console.log('pinging failed WSS not running');

        // interval.refresh()
    }, 30000);
    return interval;
}

function getObjectSize(obj: any) {
    const visitedObjects = new WeakSet();

    function sizeOf(obj: any) {
        if (obj === null || typeof obj !== "object") {
            return 0;
        }

        if (visitedObjects.has(obj)) {
            return 0;
        }

        visitedObjects.add(obj);

        let bytes = 0;

        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                bytes += key.length * 2; // assuming each character is 2 bytes
                bytes += sizeOf(obj[key]);
            }
        }

        return bytes;
    }

    return sizeOf(obj);
}