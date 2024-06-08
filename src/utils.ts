import { Db } from "mongodb";
import { ConnectedUserObj, RoomObj } from './types';

export async function setupChatrooms(
    db: Db,
    roomMap: {
        [key: string]: RoomObj;
    }
) {

    const rooms = await db.collection<RoomObj>('chat_rooms').find({}).toArray()
    rooms.forEach(roomObj => {
        const { _id, ...rest } = roomObj;
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