import {
    startServer,
    setupMongoChangeStream
} from './server';
import http from 'http';
import { ConnectedUserObj, CustomContext, RoomObj, ServerHeaders } from './types';
import { CHAT_COLLECTION, RATE_LIMIT_HALF_MIN } from './constants';
import internal from 'stream';

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

const server = http.createServer({
});

startServer(context);
setupMongoChangeStream(context).catch(e => console.log(e));

function next(socket: internal.Duplex, err: string | null, userObj?: ConnectedUserObj) {
    console.log('nextCalled')
    const extraParams: any = {};
    if (userObj) {
        userObj.rateLimitLeft = (userObj.rateLimitLeft ?? RATE_LIMIT_HALF_MIN) - 1
        if (userObj.rateLimitLeft < 0) {
            userObj.bannedUntilTS = Date.now() + 30 * 1000; // 30s
            extraParams.message = 'Too many requests';
            extraParams.code = 429;
        }
        extraParams.rateLimitLeft = userObj.rateLimitLeft;
        extraParams.rateLimitPeriod = 30; // 30s

    }
    const body = JSON.stringify({
        message: 'Unauthorized access',
        code: 401,
        ...extraParams,
    });

    const response = [
        'HTTP/1.1 401 Unauthorized',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',  // Blank line to indicate the end of headers
        body  // The actual body content
    ].join('\r\n');

    socket.write(response);
    socket.destroy();  // Properly close the socket

}

server.on('upgrade', async function upgrade(request, socket, head) {
    // Do what you normally do in `verifyClient()` here and then use
    // `WebSocketServer.prototype.handleUpgrade()`.

    if (!context.wss)
        return;
    // console.log(socket)
    const headers = request.headers as ServerHeaders;
    console.log(headers.userid, headers.roomid)
    let userObj: ConnectedUserObj | undefined;
    try {

        // This function is not defined on purpose. Implement it with your own logic.
        if (!headers.userid ||
            !headers.roomid)
            throw new Error("Invalid headers");
        userObj = context.userMap[headers.userid];
        const tsNow = Date.now();
        if (
            !userObj ||
            !context.roomMap[headers.roomid] ||
            (context.userMap[headers.userid].bannedUntilTS &&
                context.userMap[headers.userid].bannedUntilTS! > tsNow)
        )
            throw new Error("Invalid headers");

        // if (userObj.client?.OPEN) {
        //     userObj.rateLimitLeft = (userObj.rateLimitLeft ?? RATE_LIMIT_HALF_MIN) - 1
        //     if (userObj.rateLimitLeft < 0)
        //         userObj.bannedUntilTS = tsNow + 30 * 1000; // 30s ban for next request
        // }
    } catch (e) {
        console.log(e)
        next(socket, String(e), userObj);
        return;
    } finally {

    }

    context.wss.handleUpgrade(request, socket, head, function done(ws) {
        context.wss!.emit('connection', ws, request, [headers.userid, headers.roomid]);
    });
});


server.listen(8080);