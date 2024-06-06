import {
    startServer,
    setupMongoChangeStream
} from './server';
import http from 'http';
import { CustomContext, RoomObj } from './types';
import { CHAT_COLLECTION } from './constants';

let context: CustomContext = {
    cs: null,
    wss: null,
    roomMap: {
        __global__: {
            roomName: 'Public',
            userCount: 0,
        }
    },
    // This is for authentication purposes
    userMap: {},
};

const server = http.createServer();

startServer(context);
setupMongoChangeStream(context).catch(e => console.log(e));

server.on('upgrade', async function upgrade(request, socket, head) {
    // Do what you normally do in `verifyClient()` here and then use
    // `WebSocketServer.prototype.handleUpgrade()`.

    if (!context.wss)
        return;
    console.log(socket)
    let args: any[] = [];

    try {

        // This function is not defined on purpose. Implement it with your own logic.
        authenticate(request, function next(err: string | null, client: any) {
            if (err || !client) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
        })
    } catch (e) {
        socket.destroy();
        return;
    }

    context.wss.handleUpgrade(request, socket, head, function done(ws) {
        context.wss!.emit('connection', ws, request, ...args);
    });
});


server.listen(8080);