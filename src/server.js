
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import buildHistoryGraph from './buildHistoryGraph.js';

import express from 'express';
import { createServer} from 'http';

import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
dotenv.config();

import { uuidv7 } from "uuidv7";

import { fromByteArray, toByteArray } from 'base64-js';

import osc from "osc";

// oscQuery code:
import { OSCQueryDiscovery } from "oscquery";

import {username} from 'username';



let userName = await username()
console.log(userName);

let wss;

let namespaceState = {}

let config = {
    patchHistory: {
        firstBranchName: "main"
    }
}
 
//* AUTOMERGE IMPLEMENTATION
let Automerge;
let automergeRunning = false
let syncState;
let previousHash;
let patchHistory;
let patchHistoryIsDirty = false
let docID = 'forkingPathsDoc'; // Unique identifier for the document
let currentBranch = null
let onChange; // my custom automerge callback for changes made to the doc

let automergeDocuments = {
    newClone: false,
    newMerge: false,
    current: {
        doc: null
    },
    otherDocs: {

    }
}
let docUpdated = false

async function startAutomerge() {
    automergeRunning = true
    // Load Automerge asynchronously and assign it to the global variable
    Automerge = await import('@automerge/automerge');

    patchHistory = Automerge.from({
        title: "forkingpaths",
        forked_from_id: null, // used by the database to either determine this as the root of a tree of patch histories, or a fork from a stored history 
        authors: [], // this will get added to as the doc is forked from the database
        branches: {},
        branchOrder: [],
        docs: {},
        head: {
            hash: null,
            branch: null
        } ,
        userSettings: {
            focusNewBranch: true 
        },
        sequencer: {
            bpm: 120,
            ms: 500,
            traversalMode: 'Sequential'
        },
        openSoundControl: { },
        parameterSpace: { }
    })

    console.log("App not yet setup to load stored patchHistory. Starting fresh");
    // await saveDocument(patchHistoryKey, Automerge.save(patchHistory));

    syncState = Automerge.initSyncState()



    // if patchHistory doesn't contain a document, create a new one
    if (!patchHistory.docs[patchHistory.head.branch]) {

        currentBranch = Automerge.init();
        previousHash = null;

        createNewPatchHistory();

    }
}

function createNewPatchHistory(){


    // delete the document in the indexedDB instance
    // deleteDocument('patchHistory')

    //! clear the sequencer
    // sendMsgToHistoryApp({
    //     appID: 'forkingPathsMain',
    //     cmd: 'newPatchHistory'
            
    // })

    // erase the patchHistory & send a blank DAG to client(s)
    clearHistoryGraph()
    
    // init new patch history for Automerge
    let patchHistoryJSON = {
        title: "Forking Paths Patch History",
        forked_from_id: null, // used by the database to either determine this as the root of a tree of patch histories, or a fork from a stored history 
        authors: [], // this will get added to as the doc is forked from the database
        branches: {},
        branchOrder: [],
        docs: {},
        head: {
            hash: null,
            branch: config.patchHistory.firstBranchName
        },
        
        userSettings: {
            focusNewBranch:false 
        },
        sequencer: {
            bpm: 120,
            ms: 500,
            traversalMode: 'Sequential'
        },
        openSoundControl: { },
        parameterSpace: { }

    }
    // assign patch history to automerge
    patchHistory = Automerge.from(patchHistoryJSON)
    // clear the current automerge doc
    currentBranch = Automerge.init();

    let amMsg = makeChangeMessage(config.patchHistory.firstBranchName, `new history`)
        
    // Apply initial changes to the new document
    currentBranch = Automerge.change(currentBranch, amMsg, (currentBranch) => {
        currentBranch.title = config.patchHistory.firstBranchName;
        currentBranch.parameterSpace = {},
        currentBranch.openSoundControl = {}
    }, onChange, `new history`);
    

    
    let hash = Automerge.getHeads(currentBranch)[0]
    previousHash = hash


    let msg = 'initial_state'

    patchHistory = Automerge.change(patchHistory, (patchHistory) => {
        if(!patchHistory.branches[config.patchHistory.firstBranchName]){
            patchHistory.branches[config.patchHistory.firstBranchName] = {}
        }
        patchHistory.branches[config.patchHistory.firstBranchName] = {
            head: hash,
            root: null,
            parent: null,
            // doc: currentBranch,
            history: [ {hash: hash, parent: null, msg: msg} ] 
        }
        
        // encode the doc as a binary object for efficiency
        patchHistory.docs[config.patchHistory.firstBranchName] = Automerge.save(currentBranch)
        patchHistory.head.branch = config.patchHistory.firstBranchName
        patchHistory.head.hash = hash 
        patchHistory.branchOrder.push(patchHistory.head.branch)
        console.log('remember to encode the param state within the patchHistory initialization \n(see code at this line)')
        
    });     
        
    docUpdated = true
    previousHash = patchHistory.head.hash
    // send doc to history app
    reDrawHistoryGraph()

    // get a binary from the new patchHistory
    const fullBinary = Automerge.save(patchHistory);
    // send it to any connected peer(s)
    let message = {
        cmd: 'replacePatchHistory',
        data: fromByteArray(fullBinary)  // base64 encoded or send as Uint8Array directly if channel supports it
    }
    // sync with peer(s)
    // sendDataChannelMessage(message)
    console.log('** see code line above for data channel sync implementation **')
}

function clearHistoryGraph(){
    historyDAG_cy.elements().remove();
    if(existingHistoryNodeIDs){
        existingHistoryNodeIDs.clear()
    }
    historyDAG_cy.layout(graphLayouts[graphStyle]).run()
}

function reDrawHistoryGraph(){
    patchHistoryIsDirty = true

    wss.clients.forEach((client) => {
        client.send(JSON.stringify({
            appID: 'forkingPathsMain',
            cmd: 'reDrawHistoryGraph',
            data: patchHistory
                
        }))
    });

}

function init(){
    if(!automergeRunning){
        startAutomerge()
        
    }
    
}

init()
//! when we want to have OSC/UDP back into the server for using oscQuery etc, uncomment this:
// async function fetchRawOnly(ip, port) {
//     const d = new OSCQueryDiscovery();
//     const svc = await d.queryNewService(ip, port);

//     await svc.update();

//     // 1. get only paths ending in /raw
//     const rawPaths = svc
//         .flat()
//         .map(m => m.full_path)
//         .filter(p => p && p.endsWith("/raw"));

//     console.log("RAW endpoints:", rawPaths);

//     // 2. read values
//     const rawValues = {};

//     for (const path of rawPaths) {
//         const node = svc.resolvePath(path);
//         if (!node) continue;

//         // usually 1 arg for /raw, but this is safe
//         const values = [];
//         let i = 0;
//         while (true) {
//         const v = node.getValue(i);
//         if (v === null || v === undefined) break;
//         values.push(v);
//         i++;
//         }

//         rawValues[path] = values;
//     }

//     console.log("RAW VALUES:");
//     console.log(rawValues);

//     namespaceState = stripRawSuffix(rawValues)
//     console.log(namespaceState);
//     if(wss.clients & wss.clients.size > 1){
//         wss.clients.forEach((client) => {
//             client.send(JSON.stringify(namespaceState))
//         });
//     }
    
    
//     return namespaceState;
// }

// function stripRawSuffix(obj) {
//   const out = {};

//   for (const [key, value] of Object.entries(obj)) {
//     const newKey = key.replace(/\/raw$/, "");
//     out[newKey] = value;
//   }

//   return out;
// }


// async function fetchParamValues(ip, port) {
//     const d = new OSCQueryDiscovery();
//     const svc = await d.queryNewService(ip, port);

//     await svc.update();

//     // discover params via /raw
//     const rawPaths = svc
//         .flat()
//         .map(m => m.full_path)
//         .filter(p => p && p.endsWith("/raw"));

//     const paramValues = {};

//     for (const rawPath of rawPaths) {
//         const paramPath = rawPath.replace(/\/raw$/, "");
//         const node = svc.resolvePath(paramPath);
//         if (!node) continue;

//         const values = [];
//         let i = 0;
//         while (true) {
//         const v = node.getValue(i);
//         if (v === null || v === undefined) break;
//         values.push(v);
//         i++;
//         }

//         paramValues[paramPath] = values;
//     }

//     console.log("PARAM VALUES:");
//     console.log(paramValues);

//     if(wss.clients & wss.clients.size > 1){
//         wss.clients.forEach((client) => {
//             client.send(JSON.stringify(paramValues))
//         });
//     }
    
//     namespaceState = paramValues


//     return paramValues;
//     }
/*
// Receive (plain args)
const udpIn = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: 30337,
  metadata: false, // <-- plain args (numbers/strings), not {type,value} objects
});

// Send (plain args)
const udpOut = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: 0, // ephemeral local port
  remoteAddress: "127.0.0.1",
  remotePort: 30338,
  metadata: false,
});



udpIn.on("error", (err) => console.error("OSC IN error:", err));
udpOut.on("error", (err) => console.error("OSC OUT error:", err));

udpOut.open();
udpIn.open();

udpOut.on("open", () => {
    const info = udpOut.socket?.address?.();

    console.log("OSC OUT socket open");
    if (info) {
        console.log(
        `Local UDP socket bound to ${info.address}:${info.port}`
        );
    } else {
        console.log("Local UDP socket bound (ephemeral port)");
    }

    // fetchParamValues("127.0.0.1", 30339).catch(err => {
    //     console.error(err?.message ?? err);
    // });
    fetchRawOnly("127.0.0.1", 30339).catch(err => {
        console.error(err?.message ?? err);
    });
});




*/






let sequencerStates = {}

// let patchHistory;
let existingHistoryNodeIDs = new Set()

let graphStyle = 'MANUAL_DAG'
let graphLayouts = {
    // https://github.com/dagrejs/dagre/wiki#configuring-the-layout
    DAG: {
        name: 'dagre',
        rankDir: 'BT', // Set the graph direction to top-to-bottom
        nodeSep: 300, // Optional: adjust node separation
        edgeSep: 100, // Optional: adjust edge separation
        rankSep: 50, // Optional: adjust rank separation for vertical spacing,
        fit: false,
        padding: 30
    },
    // wrote this specifically to fix the ordering of branches being changed on the fly in the dagre package version (above)
    MANUAL_DAG: {
        name: 'preset',
        fit: false,
        padding: 30,
        animate: false
    },
    breadthfirst: {
        name: 'breadthfirst',

        fit: false, // whether to fit the viewport to the graph
        directed: true, // whether the tree is directed downwards (or edges can point in any direction if false)
        padding: 30, // padding on fit
        circle: false, // put depths in concentric circles if true, put depths top down if false
        grid: false, // whether to create an even grid into which the DAG is placed (circle:false only)
        spacingFactor: 1.75, // positive spacing factor, larger => more space between nodes (N.B. n/a if causes overlap)
        boundingBox: undefined, // constrain layout bounds; { x1, y1, x2, y2 } or { x1, y1, w, h }
        avoidOverlap: true, // prevents node overlap, may overflow boundingBox if not enough space
        nodeDimensionsIncludeLabels: false, // Excludes the label when calculating node bounding boxes for the layout algorithm
        roots: undefined, // the roots of the trees
        depthSort: undefined, // a sorting function to order nodes at equal depth. e.g. function(a, b){ return a.data('weight') - b.data('weight') }
        animate: false, // whether to transition the node positions
        animationDuration: 500, // duration of animation in ms if enabled
        animationEasing: undefined, // easing of animation if enabled,
        animateFilter: function ( node, i ){ return true; }, // a function that determines whether the node should be animated.  All nodes animated by default on animate enabled.  Non-animated nodes are positioned immediately when the layout starts
        ready: undefined, // callback on layoutready
        stop: undefined, // callback on layoutstop
        transform: function (node, position ){ return position; } // transform a given node position. Useful for changing flow direction in discrete layouts

    }


}




// Create Cytoscape instance
cytoscape.use( dagre );
const historyDAG_cy = cytoscape({
    headless: true, // Enable headless mode for server-side rendering

    // container: document.getElementById('docHistory-cy'),
    elements: [],
//   zoom: parseFloat(localStorage.getItem('docHistoryCy_Zoom')) || 1., 
    // viewport: {
    //     zoom: parseFloat(localStorage.getItem('docHistoryCy_Zoom')) || 1.
    // },
    boxSelectionEnabled: true,
    selectionType: "additive",
    zoomingEnabled: false,
    
    layout: graphLayouts[graphStyle],  
    style: [
        {
            selector: 'node',
            style: {
                'background-color': 'data(color)', // based on edit type
                'label': 'data(label)', // Use the custom label attribute
                'width': 30,
                'height': 30,
                'color': '#000',            // Label text color
                'text-valign': 'center',    // Vertically center the label
                'text-halign': 'right',      // Horizontally align label to the left of the node
                'text-margin-x': 15, // 
                'text-wrap': 'wrap',
                'text-max-width': 120
                // 'text-margin-y': 15, // move the label down a little to make space for branch edges
                // 'shape': 'data(shape)' // set this for accessibility (colour blindness)
            }
        
        },
        {
            selector: 'edge',
            style: {
                'width': 6,
                'line-color': '#ccc',
                'target-arrow-shape': 'triangle',
                'target-arrow-color': '#ccc',
                'target-arrow-width': 20, // Size of the target endpoint shape
                'curve-style': 'bezier' // Use a Bezier curve to help arrows render more clearly

            }
        },
        {
            selector: 'node.highlighted',
            style: {
                'border-color': '#228B22', // Highlight color
                'border-width': 15,
                'shape': 'rectangle'
            }
        },
        {
            selector: '.sequencerSelectionBox',
            style: {
                'border-color': 'blue', // Highlight color
                'border-width': 4,
                'shape': 'rectangle',
                'background-color': 'white',
                "background-opacity": 0,
                "width": 50,
                "height": 'data(height)',
                "label": '',
                "z-index": -1

            }
        },
        {
            selector: '.sequencerSelectionBox-handle',
            style: {
                // 'border-color': 'blue', // Highlight color
                'border-width': 0,
                'shape': 'ellipse',
                'background-color': 'blue',
                // "background-opacity": 0,
                "width": '10',
                "height": '10',
                "label": '',
                "z-index": 10

            }
        },
        {
            selector: '.sequencerNode',
            style: {
                'border-color': '#000000',  // Change to your desired color
                'border-width': '8px',
                'border-style': 'solid'


            }
        },
        {
            selector: '.sequencerEdge',
            style: {
                // 'border-color': 'blue', // Highlight color
                'line-color': 'blue',
                "width": '10',
                'target-arrow-color': 'blue'


            }
        },
    ]
});

// A simple in-memory store for rooms
const rooms = {};

// Helper function to assign a client to a room
function assignRoom(ws, desiredRoom) {
    // If a specific room is provided
    if (desiredRoom) {
      // If the desired room already exists
      if (rooms[desiredRoom]) {
        // If room is not full, assign the client there.
        if (rooms[desiredRoom].length < 2) {
          rooms[desiredRoom].push(ws);
          return desiredRoom;
        } else {
          console.log(`Desired room ${desiredRoom} is full. Falling back to default assignment.`);
        }
      } else {
        // Create the room if it doesn't exist.
        rooms[desiredRoom] = [ws];
        return desiredRoom;
      }
    }
    
    // Fallback: Loop over existing rooms and join one that has less than 2 clients.
    for (const room in rooms) {
      if (rooms[room].length < 2) {
        rooms[room].push(ws);
        return room;
      }
    }
    
    // If no room is available, create a new one with a default naming scheme.
    const newRoom = `room${Object.keys(rooms).length + 1}`;
    rooms[newRoom] = [ws];
    return newRoom;
  }

const PORT = process.env.PORT || 3001;

// Create an Express app (Only for handling basic HTTP requests)
const app = express();

app.use(express.json({ limit: '10mb' })); // for parsing JSON bodies

// 
// app.use('/api/patchHistories', patchHistoryRouter);
// app.use('/api/synthFiles', synthRouter);


// Serve static frontend files from Vite's `dist` folder
app.use(express.static('dist'));

// Create an HTTP server and attach WebSocket
const server = createServer(app, (req, res)=>{
    res.writeHead(200);
    res.end('WebRTC signaling server is running\n');
});
// Create a WebSocket server that only upgrades `/ws` requests
wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    console.log('🚀 WebSocket upgrade request received');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  
let numClients = 0
// Handle client connections
wss.on('connection', (ws, req) => {
    numClients++

    const clientIp = req.socket.remoteAddress;
    console.log(`New connection from ${clientIp}`);
    console.log(`Number of clients: ${numClients}`)
    
    // Handle messages received from clients
    ws.on('message', (message) => {
        // console.log(message)
        let msg = JSON.parse(message)
        
        switch(msg.cmd){

            case 'maxParamUpdate':
            case 'maxStateRecall':
            case 'maxCachedState':

                wss.clients.forEach((client) => {
                    client.send(JSON.stringify(msg))
                });
                
            break

            // case 'maxCachedState':
            //     // console.log(msg)

            //     wss.clients.forEach((client) => {
            //         client.send(JSON.stringify(msg))
            //     });
                
            // break

            // case 'maxStateRecall':
            //     // console.log(msg.data)
            //     wss.clients.forEach((client) => {
            //         client.send(JSON.stringify(msg))
            //         // if (client !== ws) {
                        
            //         // }
            //     });
            // break
            case "oscRecall":
                console.log('recall', msg.data)
                for (const [address, args] of Object.entries(msg.data)) {
                    console.log('recall outgoing', address, args)
                    //   // pass-through
                    if(udpOut){
                        udpOut.send({
                            address: address,
                            args: args,
                        });
                    }

                }
                
            break

            case 'newPatchHistory':

            //todo: get the namespace state from max patch then send here:
                    //             wss.clients.forEach((client) => {
                    //     client.send(JSON.stringify({
                    //         cmd: 'namespaceState',
                    //         data: namespaceState
                    //     }))
                    // });
                //! when we want to have OSC/UDP back into the server for using oscQuery etc, uncomment this:
                // fetchRawOnly("127.0.0.1", 30339).then((result) => {
                //     namespaceState = result;
                //     console.log("Resolved namespaceState:", namespaceState);
                
                //     console.log('new patch hitory triggered\ncheck for race conditions\nwhen receiving namespaceState:\n\n', namespaceState)
                //     if(!namespaceState){
                //         console.log('error no namespaceState retrieved')
                //         return
                //     }

                //     console.log(namespaceState)
                //     wss.clients.forEach((client) => {
                //         client.send(JSON.stringify({
                //             cmd: 'namespaceState',
                //             data: namespaceState
                //         }))
                //     });
                // });

            break;



            case 'updateGraph':
                // patchHistory = msg.patchHistory
                // console.log(patchHistory)
                updateHistoryGraph(ws, patchHistory, msg.docHistoryGraphStyling)
            break

        

            // case 'eraseRoomPatchHistory':
            //     // erase the patch history for all peers in this room
            //     historyDAG_cy.elements().remove();
            //     if(existingHistoryNodeIDs){
            //         existingHistoryNodeIDs.clear()
            //     }
            //     historyDAG_cy.layout(graphLayouts[graphStyle]).run()
            // break

            case 'collapseNodes':

            break

            case 'expandNodes':

            break
            case 'joinRoom':
                // Assign the connecting client to a room
                ws.room = assignRoom(ws, msg.room);
                
                ws.peerID = msg.peerID
                console.log(`New client assigned to ${ws.room}`);
                // update all lobby pages
                wss.clients.forEach((client) => {
                    if (client !== ws && client.lobby === true) {
                        sendRooms(client)
                    }
                });

                if(sequencerStates[ws.room]){
                    console.log('sequencer state exists for this room:', sequencerStates[ws.room])
                } else {
                    sequencerStates[ws.room] = {}
                }

            break
            case 'newPeer':
                // Convert the incoming message to a string if it’s a Buffer.
                const payload = Buffer.isBuffer(message) ? message.toString() : message;
                // peers[msg.peerID] = {}

               
                // Relay the message to the other client in the same room (if exists)
                // Use ws.room (assigned in 'joinRoom') to determine the correct room.
                const clientRoom = ws.room;
                if (clientRoom && rooms[clientRoom]) {
                rooms[clientRoom].forEach(client => {
                    if (client !== ws && client.readyState === ws.OPEN) {
                    client.send(JSON.stringify({
                        cmd: 'newPeer',
                        msg: payload
                    }), { binary: false });
                    }
                });
                } else {
                console.error('Client not assigned to any room');
                }

                
 
            break

            case 'getRooms': 
                ws.lobby = true
                // Build an array of active rooms.
                sendRooms(ws)
            break;

            case 'sequencerStateUpdate':
                sequencerStates[msg.room] = msg.state
                
                
            break

            case 'getSequencerState':
                ws.send(JSON.stringify({
                    cmd: 'sequencerState',
                    state: sequencerStates[msg.room]
                }))
            break

            // case "externalParamUpdate":

                
            //     // ws.send(message)

            //     wss.clients.forEach((client) => {

            //         if (client !== ws) {
            //             console.log('sending', JSON.parse(message))
            //             client.send(JSON.stringify(msg))
            //         }
            //     });
            // break;
              
            
            default: console.log('no switch case exists for msg:', message)
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log('Client disconnected');
        numClients--
        console.log('number of clients:', numClients)
        if (ws.room && rooms[ws.room]) {
            // Remove the client from the room
            rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
            // Clean up the room if empty
            if (rooms[ws.room].length === 0) {
                // first clear the sequencer state
                delete sequencerStates[ws.room]
                // then remote the room
                delete rooms[ws.room];
            }
            // update all lobby clients
            wss.clients.forEach((client) => {
                if (client.lobby === true) {
                    sendRooms(client)
                }
            });
        }

    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`✅ WebSocket server running on ws://localhost:${PORT}`);
});

function sendRooms(ws){
    const activeRooms = [];
    for (const roomName in rooms) {
        // Only include rooms with at least one peer.
        if (rooms[roomName].length > 0) {
        const roomInfo = {
            room: roomName,
            peer1: rooms[roomName][0].peerID || null,
            peer2: rooms[roomName].length > 1 ? rooms[roomName][1].peerID || null : null,
            sequencerState: ws.sequencerState || 'empty'
        };
        activeRooms.push(roomInfo);
        }
    }
    // Send the room info back to the client that requested it.
    ws.send(JSON.stringify({
        cmd: 'roomsInfo',
        rooms: activeRooms
    }));
}

function updateHistoryGraph(ws, patchHistory, docHistoryGraphStyling){

    if (!existingHistoryNodeIDs || existingHistoryNodeIDs.size === 0){
        existingHistoryNodeIDs = new Set(historyDAG_cy.nodes().map(node => node.id()));
    }

    if(!patchHistory || !patchHistory.branchOrder) return
    const { nodes, edges, historyNodes } = buildHistoryGraph(
        patchHistory,
        existingHistoryNodeIDs,
        docHistoryGraphStyling
    );
    // dumb hack for weird bug where the parent prop in each node was coming out undefined despite existing in the return statement of buildHistoryGraph
    const stringed = JSON.parse(JSON.stringify(nodes, null, 2))
    // Run the layout and get the rendered graph
    // historyDAG_cy.layout(layout).run();
    try {
        if (nodes.length > 0) {
            historyDAG_cy.add(stringed);
        }
        if (edges.length > 0) {
            historyDAG_cy.add(edges); // 👈 this is where it was crashing
        }
    } catch (err) {
        console.error('❌ Failed to update Cytoscape graph:', err.message);
        console.error('   ➤ Possibly due to missing source or target node.');
        console.error('   ➤ Reason:', err.stack);
        console.error('   ➤ Edges:', JSON.stringify(edges, null, 2));
        // send message to client to force a new patch history
        setTimeout(() => {
            ws.send(JSON.stringify({
                cmd: "forceNewPatchHistoryDueToError", 
                message: 'Server failed to create graph; forcing a new patch history now...'
            }))
        }, 1000);


        return; // prevent graph layout from running
    }
    existingHistoryNodeIDs = historyNodes

    historyDAG_cy.layout(graphLayouts[graphStyle]).run();

    // Send the graph JSON back to the client
    const graphJSON = historyDAG_cy.json();

    ws.send(JSON.stringify({
        cmd: "historyGraphRenderUpdate", 
        data: graphJSON
    }))
}



// udpIn.on("message", (msg, timeTag, info) => {
//       console.log(msg.address, msg.args);

//     wss.clients.forEach((client) => {
//         client.send(JSON.stringify({
//             cmd: 'OSCmsg',
//             data: msg
//         }))

//     });


// });



    //*
    //*
    //* UTILITY FUNCTIONS
    //* reusable helper functions and utility code for debugging, logging, etc.
    //*


    function makeChangeMessage(branchName, msg){
        let amMsg = JSON.stringify({
            branch: branchName,
            msg: msg
        })
        return amMsg
    }
