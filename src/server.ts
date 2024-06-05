'use server';

import { MongoClient, ServerApiVersion, ChangeStream, ChangeStreamInsertDocument } from "mongodb";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import WebSocket, { WebSocketServer, } from 'ws';

// Replace the uri string with your MongoDB deployment's connection string
const uri = process.env.MONGODB_URL!;
const dbName = process.env.DB_NAME!;
const colName = process.env.COL_NAME!;
console.log(dbName, colName);

export interface ChatMessage {
    msg: string;
    imageUrl: string;
    displayName: string;
    ts: number;
    seen: boolean;
};

export interface ActiveWebsocket extends WebSocket {
    isAlive: boolean;
};

export interface WebsocketChangeStreamHandler {
    cs?: ChangeStream | null;
    wss?: WebSocketServer | null;
    pinger?: NodeJS.Timeout;
};

type ChangeStreamInsertDoc = ChangeStreamInsertDocument<ChatMessage>;


export const simulateAsyncPause = (t: number) =>
    new Promise(resolve => {
        setTimeout(() => resolve(''), t);
    });

export async function setupMongoChangeStream(
    changeStream: WebsocketChangeStreamHandler,
    wss: WebSocketServer,
) {
    const client = new MongoClient(uri,);
    try {
        const database = client.db(dbName);
        const chat_server = database.collection<ChatMessage>(colName);
        // Open a Change Stream on the "haikus" collection
        changeStream.cs = chat_server.watch();

        // Set up a change stream listener when change events are emitted
        changeStream.cs.on("change", next => {
            // Print any change event
            console.log("received a change to the collection: \t", next);
            wss.clients.forEach((ws) => {
                if (next.operationType === 'insert' && next.ns.coll === colName) {
                    const data = next as ChangeStreamInsertDoc
                    ws.send(JSON.stringify(data.fullDocument), (error) => {

                    })
                }
            })
        });

        // Pause before inserting a document
        await simulateAsyncPause(1000);

        // Insert a new document into the collection
        await chat_server.insertOne({
            displayName: "Shriveled Datum",
            msg: "No bytes, no problem. Just insert a document, in MongoDB",
            imageUrl: 'https://imagedelivery.net/9i0Mt_dC7lopRIG36ZQvKw/XScape%20Legends%20Card%20Assassin.png/w=200',
            ts: Date.now(),
            seen: false,
        });

        while (true) {

            const t = Date.now()
            console.log('changeStream running...', t)
            await simulateAsyncPause(3000);
            console.log('changeStream running...', t)
            if (changeStream.cs.closed) {
                throw new Error("WSS connection reset!");
            }
        }
        // await changeStream.close()
        // console.log('changeStream closing...', Date.now())
    } finally {
        // Close the database connection on completion or error
        await client.close();
    }
}

export async function setupWebsocketListeners(
    changeStreamWS: WebsocketChangeStreamHandler,
) {
    if (changeStreamWS.wss) {
        changeStreamWS.wss.on('connection', function connection(ws: ActiveWebsocket) {
            ws.isAlive = true;
            ws.on('error', console.error);
            ws.on('pong', (ws: ActiveWebsocket, buffer: Buffer) => {
                ws.isAlive = true;
            });
        });

        changeStreamWS.wss.on('listening', () => {
            console.log('listening')
            setupMongoChangeStream(changeStreamWS, changeStreamWS.wss!).catch(e => console.log(e));
        });

        changeStreamWS.wss.on('close', async function close() {
            try {
                changeStreamWS.wss!.removeAllListeners()
            } catch (e) { }
            console.log('closed')
            if (changeStreamWS.pinger)
                clearInterval(changeStreamWS.pinger);
            console.log('changestream:', changeStreamWS)
            if (changeStreamWS.cs) {
                try {
                    await changeStreamWS.cs.close();
                    console.log("closed changeStream")
                    await simulateAsyncPause(4000);
                    changeStreamWS.wss = new WebSocketServer({ port: 8080 });
                    changeStreamWS.pinger = setupPinging(changeStreamWS);
                    setupWebsocketListeners(changeStreamWS);

                } catch (e) {
                    console.log('ERROR inside close():', e)
                }

            }
        });


    }
}

export function setupPinging(changeStreamWS: WebsocketChangeStreamHandler) {
    const interval = setInterval(function ping() {
        console.log('pinging ', Date.now())
        if (changeStreamWS.wss) {
            changeStreamWS.wss.clients.forEach(function each(ws) {
                const activeWs = ws as ActiveWebsocket;
                if (!activeWs.isAlive) return activeWs.terminate();

                activeWs.isAlive = false;
                activeWs.ping();
            });
            changeStreamWS.wss!.close()
        }

        // interval.refresh()
    }, 10000);
    return interval;
}