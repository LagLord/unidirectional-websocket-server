import { Db } from "mongodb";
import { ChatMessage, CircularArray, ConnectedUserObj, RoomObj } from './types';
import { COMPRESSION_OPTIONS, GLOBAL_SERVER_NAME, MESSAGE_BUFFER_LEN } from "./constants";
import zlib from 'node:zlib';

//@ts-ignore
const deployment: 'prod' | 'dev' = process.env.DEPLOYMENT!;

export async function setupChatrooms(
    db: Db,
    roomMap: {
        [key: string]: RoomObj;
    }
) {

    const rooms = await db.collection<RoomObj>('chat_rooms').find({}).toArray()
    rooms.forEach(roomObj => {
        const { _id, ...rest } = roomObj;
        rest.newMessages = {
            buffer: new Array(MESSAGE_BUFFER_LEN),
            head: 0,
        }
        roomMap[_id.toString()] = rest;
    })
}

export async function setupUserMap(
    db: Db,
    userMap: {
        [key: string]: ConnectedUserObj | null;
    }
) {

    const users = await db.collection<ConnectedUserObj>('users').find({}).toArray();
    users.forEach(userObj => {
        userMap[userObj._id.toString()] = {
            displayName: userObj.displayName,
            profilePicture: userObj.profilePicture,
            bio: userObj.bio,
        };
    })
}

export async function getRoomMessages(
    db: Db,
    roomId: string,
    room: RoomObj,
    userMap: {
        [key: string]: ConnectedUserObj | null;
    },
) {
    const pipeline: any = [
        {
            $match: { roomId },
        },
        { $sort: { ts: -1 } },
        { $limit: MESSAGE_BUFFER_LEN },
        { $sort: { ts: 1 } },
        { $project: { _id: 0 } },
    ];

    const roomMessages = await db.collection('chat_server').
        aggregate<ChatMessage>(pipeline).toArray();
    if (deployment === 'dev')
        console.log(`Found ${roomMessages.length} messages for ${room.roomName} room`)
    console.log('roomMessage Cnt:', roomMessages.length)
    roomMessages.forEach((message, idx) => {
        const user = userMap[message.userId];
        if (user) {
            message.bio = user.bio;
            message.displayName = user.displayName;
            message.imageUrl = user.profilePicture;
            pushMessage(room.newMessages, compressMessage(message));
        }
        console.log(message.userId, message.msg, idx)
    })
}

export function compressMessage(msg: ChatMessage) {
    const jsonString = JSON.stringify(msg);
    const buffer = Buffer.from(jsonString, 'utf-8');

    const messageBuffer = zlib.deflateSync(buffer, COMPRESSION_OPTIONS);
    // Set compress bit if compressed
    const metadataBuffer = Buffer.alloc(1);
    metadataBuffer.writeUInt8(1, 0);
    if (deployment === 'dev')
        console.log(`Message length without compression : ${buffer.length}\tAfter: ${messageBuffer.length}}`)
    return Buffer.concat([messageBuffer, metadataBuffer]);
}

export async function pushMessage(arr: CircularArray, msg: Buffer) {
    if (arr.head < arr.buffer.length) {
        arr.buffer[arr.head] = msg;
        arr.head += 1;
    } else {
        arr.buffer[0] = msg;
        arr.head = 1;
    }
}