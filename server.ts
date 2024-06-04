'use server';

import { MongoClient, ServerApiVersion } from "mongodb";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Replace the uri string with your MongoDB deployment's connection string
const uri = process.env.MONGODB_URL!;
console.log(uri)
const client = new MongoClient(uri);

const simulateAsyncPause = () =>
    new Promise(resolve => {
        setTimeout(() => resolve(1000));
    });

let changeStream;

interface ChatMessage {
    msg: string;
    imageUrl: string;
    displayName: string;
    ts: number;
    seen: boolean;
};

async function run() {
    try {
        const database = client.db("Zapmint");
        const chat_server = database.collection<ChatMessage>("chat_server");

        // Open a Change Stream on the "haikus" collection
        changeStream = chat_server.watch();

        // Set up a change stream listener when change events are emitted
        changeStream.on("change", next => {
            // Print any change event
            console.log("received a change to the collection: \t", next);
        });

        // Pause before inserting a document
        await simulateAsyncPause();

        // Insert a new document into the collection
        await chat_server.insertOne({
            displayName: "Shriveled Datum",
            msg: "No bytes, no problem. Just insert a document, in MongoDB",
            imageUrl: 'https://imagedelivery.net/9i0Mt_dC7lopRIG36ZQvKw/XScape%20Legends%20Card%20Assassin.png/w=200',
            ts: Date.now(),
            seen: false,
        });

        // Pause before closing the change stream
        await simulateAsyncPause();

        // Close the change stream and print a message to the console when it is closed
        await changeStream.close();
        console.log("closed the change stream");
    } finally {
        // Close the database connection on completion or error
        await client.close();
    }
}
run().catch(console.dir);