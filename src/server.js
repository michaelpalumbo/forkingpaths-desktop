
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import buildHistoryGraph from './buildHistoryGraph.js';

import fs from 'node:fs';
import path from 'path';


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
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// 1. Get the current file path (similar to __filename)
const __filename = fileURLToPath(import.meta.url);
// 2. Get the directory name (similar to __dirname)
const __dirname = dirname(__filename);

let userName = await username()
console.log(userName);

let wss;

let namespaceState = {}

let config = {
    dbStore:{
        saveInterval: 1000
    },
    patchHistory: {
        firstBranchName: "main"
    },
    docHistoryGraphStyling: {
        nodeColours: {
            connect: "#004cb8",
            disconnect: "#b8000f",
            // add: "#00b806",
            // remove: "#b8000f",
            merge: "#e0ad1a",
            paramUpdate: "#6b00b8",
            gesture: "#00ffff",
            clear: "#000000",
            sequence: "#00b39b", 
            draw: "#b85c00",
            blank_patch: "#ccc"
        }
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
    let storedHistory = fs.readFileSync(path.join(__dirname, 'storage/patchHistoryStore.automerge'))

    // Load Automerge asynchronously and assign it to the global variable
    Automerge = await import('@automerge/automerge');

    // if no prior history, create new one
    if(!storedHistory){
            
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
    } else {
        patchHistory = Automerge.load(storedHistory)
        
    }

    console.log(patchHistory)
    console.log("App not yet setup to load stored patchHistory. Starting fresh");
    // await saveDocument(patchHistoryKey, Automerge.save(patchHistory));

    syncState = Automerge.initSyncState()



    // if patchHistory doesn't contain a document, create a new one
    if (!patchHistory.docs[patchHistory.head.branch]) {

        currentBranch = Automerge.init();
        previousHash = null;

        createNewPatchHistory();

    } else {

        // patchHistory does contain at least one document, so grab whichever is the one that was last looked at
        currentBranch = Automerge.load(patchHistory.docs[patchHistory.head.branch]);

        // wait 1 second before loading content (give the audio worklet a moment to load)
        setTimeout(()=>{

            oscRecall(currentBranch.openSoundControl)

            // recall max patch state
            maxStateRecall(currentBranch.parameterSpace)
            
            previousHash = patchHistory.head.hash
            
            patchHistoryIsDirty = true
            // send doc to history app
            updateHistoryGraph()

        }, 1000);
    }
}

// Set an interval to periodically save patchHistory to IndexedDB
setInterval(async () => {
    
    // if(patchHistory && syncMessageDataChannel && syncMessageDataChannel.readyState === 'closed'){
    if(patchHistory && docUpdated){
        
        fs.writeFileSync(path.join(__dirname, 'storage/patchHistoryStore.automerge'), Automerge.save(patchHistory))
        // await saveDocument(docID, Automerge.save(currentBranch));
        // await dbStore.saveDocument(1, Automerge.save(patchHistory));
        docUpdated = false
    }

}, config.dbStore.saveInterval);

function applyChange(doc, changeCallback, onChangeCallback, changeMessage) {
    // in this condition, we are applying a change on the current branch
    if(automergeDocuments.newClone === false ){
        let amMsg = makeChangeMessage(patchHistory.head.branch, changeMessage)
        // we are working from a head

        // grab the current hash before making the new change:
        previousHash = patchHistory.head.hash
        
        // Apply the change using Automerge.change
        currentBranch = Automerge.change(currentBranch, amMsg, changeCallback);


        // If there was a change, call the onChangeCallback
        if (currentBranch !== doc && typeof onChangeCallback === 'function') {
            let hash = Automerge.getHeads(currentBranch)[0]
            
            patchHistory = Automerge.change(patchHistory, (patchHistory) => {

                // if the current patchHistory was loaded from the database, then we need to create a fork for this new change
                if (patchHistory.hasBeenModified === false) {
                    patchHistory.forked_from_id = patchHistory.databaseID
                    patchHistory.hasBeenModified = true
                    forkHistoryInDatabase(patchHistory.databaseID)
                }
                // Initialize the branch patchHistorydata if it doesn't already exist
                if (!patchHistory.branches[patchHistory.head.branch]) {
                    patchHistory.branches[patchHistory.head.branch] = { head: null, history: [] };
                }
                // Update the head property
                patchHistory.branches[patchHistory.head.branch].head = hash;

                // Push the new history entry into the existing array
                patchHistory.branches[patchHistory.head.branch].history.push({
                    hash: hash,
                    parent: previousHash,
                    msg: changeMessage,
                    timeStamp: new Date().getTime()

                });

                // encode the doc as a binary object for efficiency
                patchHistory.docs[patchHistory.head.branch] = Automerge.save(currentBranch)
                // store the HEAD info
                patchHistory.head.hash = hash
                patchHistory.timeStamp = new Date().getTime()
                //? patchHistory.head.branch = currentBranch.title
                
            });


            
            // updatePatchHistoryDatabase()

            onChangeCallback(currentBranch);
        }
        return currentBranch;
    } else {
        // player has made changes to an earlier version, so create a branch and set currentBranch to new clone

        // store previous currentBranch in automergeDocuments, and its property is the hash of its head
        automergeDocuments.otherDocs[patchHistory.head.branch] = currentBranch
        // set currentBranch to current cloned doc
        currentBranch = Automerge.clone(automergeDocuments.current.doc)

        // create a new branch name
        const newBranchName = uuidv7();
        // use the new branch title
        let amMsg = makeChangeMessage(patchHistory.head.branch, changeMessage)

        // grab the current hash before making the new change:
        previousHash = Automerge.getHeads(currentBranch)[0]
        
        // Apply the change using Automerge.change
        currentBranch = Automerge.change(currentBranch, amMsg, changeCallback);
        let hash = Automerge.getHeads(currentBranch)[0]
        
        // If there was a change, call the onChangeCallback
        if (currentBranch !== doc && typeof onChangeCallback === 'function') {   
            const timestamp = new Date().getTime()
            patchHistory = Automerge.change(patchHistory, (patchHistory) => {

                // create the branch
                patchHistory.branches[newBranchName] = {
                    head: hash,
                    parent: previousHash,
                    history: [{
                        hash: hash,
                        msg: changeMessage,
                        parent: previousHash,
                        timeStamp: timestamp
                    }]
                }

                // store current doc
                patchHistory.docs[newBranchName] = Automerge.save(currentBranch)
                
                // store the HEAD info
                patchHistory.head.hash = hash
                patchHistory.head.branch = newBranchName

                patchHistory.timeStamp = timestamp

                // store the branch name so that we can ensure its ordering later on
                patchHistory.branchOrder.push(newBranchName)

                // if the current patchHistory was loaded from the database, then we need to create a fork for this new change
                if (patchHistory.hasBeenModified === false) {
                    patchHistory.forked_from_id = patchHistory.databaseID
                    patchHistory.hasBeenModified = true
                    forkHistoryInDatabase(patchHistory.databaseID)
                }
            });
            
            // makeBranch(changeMessage, Automerge.getHeads(newDoc)[0])
            onChangeCallback(currentBranch);

            // updatePatchHistoryDatabase()
            automergeDocuments.newClone = false

        }
        return currentBranch;

    }
    

}

// define the onChange Callback
onChange = () => {
    // send to peer(s)
    sendSyncMessage()
    // update synth audio graph
    // loadSynthGraph()
    // You can add any additional logic here, such as saving to IndexedDB

    // set docUpdated so that indexedDB will save it
    docUpdated = true

    patchHistoryIsDirty = true
    // update the historyGraph
    updateHistoryGraph()


};

async function loadVersion(targetHash, branch, fromPeer, fromPeerSequencer) {
    // store the hash and branch for if a new peer joins
    // newPeerHash = targetHash
    // newPeerBranch = branch

    // get the head from this branch
    let head = patchHistory.branches[branch].head
    // get the automerge doc associated with the requested hash
    let requestedDoc = loadAutomergeDoc(branch)



    // Use `Automerge.view()` to view the state at this specific point in history
    const historicalView = Automerge.view(requestedDoc, [targetHash]);

    console.log(historicalView)

    oscRecall(historicalView.openSoundControl)

    // recall max patch state
    maxStateRecall(historicalView.parameterSpace)

    // ⬇️ Optional sync logic for collaboration mode
    // const versionSyncMode = localStorage.getItem('syncMode') || 'shared';

    // if (versionSyncMode === 'shared') {
    //     // Propose to replace current state for both peers
    //     requestMergeOrReplace('replace', Automerge.save(historicalView));
    //     return; // Stop here — the update will happen after peer accepts
    // }
    
    // Check if we're on the head; reset clone if true (so we don't trigger opening a new branch with changes made to head)
    // compare the point in history we want (targetHash) against the head of its associated branch (head)
    if (head === targetHash){

        // no need to create a new branch if the user makes changes after this operation
        automergeDocuments.newClone = false

        oscRecall(historicalView.openSoundControl)

        // recall max patch state
        maxStateRecall(historicalView.parameterSpace)
        // update patchHistory to set the current head and change hash
        patchHistory = Automerge.change(patchHistory, (patchHistory) => {
            // store the HEAD info (the most recent HEAD and branch that were viewed or operated on)
            patchHistory.head.hash = targetHash
            patchHistory.head.branch = branch
        });
        // set global var for easy checking
        automergeDocuments.current = {
            doc: requestedDoc
        }

        
    } 

    // this is necessary for loading a hash on another branch that ISN'T the head
    else if (branch != patchHistory.head.branch) {

        oscRecall(historicalView.openSoundControl)

        // recall max patch state
        maxStateRecall(historicalView.parameterSpace)

        // set global var for easy checking
        automergeDocuments.current = {
            doc: requestedDoc
        }
        // update patchHistory to set the current head and change hash
        patchHistory = Automerge.change(patchHistory, (patchHistory) => {
            // store the HEAD info (the most recent HEAD and branch that were viewed or operated on)
            patchHistory.head.hash = targetHash
            patchHistory.head.branch = branch
        });
        // set newClone to true
        automergeDocuments.newClone = true



    }
    // the selected hash belongs to the current branch
    else {
        oscRecall(historicalView.openSoundControl)

        // recall max patch state
        maxStateRecall(historicalView.parameterSpace)
        // create a clone of the branch in case the player begins making changes
        let clonedDoc = Automerge.clone(historicalView)
        // store it
        automergeDocuments.current = {
            doc: clonedDoc
        }
        // set newClone to true
        automergeDocuments.newClone = true

        // update patchHistory to set the current head and change hash
        patchHistory = Automerge.change(patchHistory, (patchHistory) => {
            // store the HEAD info (the most recent HEAD and branch that were viewed or operated on)
            patchHistory.head.hash = targetHash
            patchHistory.head.branch = branch
        });
    }



    
    // ⬇️ Optional sync/permission handling AFTER local load
    /*
    const recallMode = getVersionRecallMode();
    // ensure that loadVersion calls from the peer don't make past this point, becuase otherwise they'd send it back and forth forever 
    if (recallMode === 'openLoadVersion' && !fromPeer && !fromPeerSequencer) {
        // console.log('openVersionRecall')
        openVersionRecall(targetHash, branch);
    }

    if (recallMode === 'requestOpenLoadVersion'  && !fromPeer) {
        // requestVersionRecallWithPermission(currentBranch, Automerge.getHeads(currentBranch)[0], patchHistory.head.branch);
        console.warn('not set up yet')
    }
    */
} 

// merge 2 versions & create a new node in the graph
function createMerge(nodes){
    let doc1 = nodes[0]
    let doc2 = nodes[1]

    // load historical views of both docs

    let head1 = patchHistory.branches[doc1.branch].head
    let requestedDoc1 = loadAutomergeDoc(doc1.branch)
    // const historicalView1 = Automerge.view(requestedDoc1, [doc1.id]);

    let head2 = patchHistory.branches[doc2.branch].head
    let requestedDoc2 = loadAutomergeDoc(doc2.branch)
    // const historicalView2 = Automerge.view(requestedDoc2, [doc2.id]);

    // console.log(requestedDoc1, requestedDoc2)

    let mergedDoc = Automerge.merge(requestedDoc1, requestedDoc2)

    
    // store previous currentBranch in automergeDocuments, and its property is the hash of its head
    //? automergeDocuments.otherDocs[patchHistory.head.branch] = currentBranch

    // grab the current hash before making the new change:
    // previousHash = Automerge.getHeads(currentBranch)[0]
    // we previously used this to get the hashes, but it means it grabs just the leaves of both branches, when what we want are the actual parent nodes (see next line that is not commented out)
    // let hashes = Automerge.getHeads(mergedDoc)
    let hashes = [ doc1.id, doc2.id ]

    // create empty change to 'flatten' the merged Doc
    currentBranch = Automerge.emptyChange(mergedDoc);

    let hash = Automerge.getHeads(currentBranch)[0]

    const newBranchName = uuidv7()

    patchHistory = Automerge.change(patchHistory, { message: `merge parents: ${doc1.id} ${doc2.id} `}, (patchHistory) => {

        // Initialize the branch patchHistorydata if it doesn't already exist
        if (!patchHistory.branches[newBranchName]) {
            patchHistory.branches[newBranchName] = { head: null, parent: [ doc1.id, doc2.id ], history: [] };
            
        }

        // Update the head property
        patchHistory.branches[newBranchName].head = hash;

        // Push the new history entry into the existing array
        patchHistory.branches[newBranchName].history.push({
            hash: hash,
            msg: 'merge',
            parent: hashes,
            nodes: [doc1, doc2]

        });
        // store current doc
        patchHistory.docs[newBranchName] = Automerge.save(currentBranch)
        
        // store the HEAD info
        patchHistory.head.hash = hash
        patchHistory.head.branch = newBranchName

        // store the branch name so that we can ensure its ordering later on
        patchHistory.branchOrder.push(newBranchName)
    });

    // set docUpdated so that indexedDB will save it
    docUpdated = true
    
    oscRecall(patchHistory.openSoundControl)

    // recall max patch state
    maxStateRecall(patchHistory.parameterSpace)
    
    // update the historyGraph
    updateHistoryGraph()



}

function sendSyncMessage() {
    // todo: if we want to setup p2p, uncomment this
    /*
    if(!roomDetails.peer1 || !roomDetails.peer2){
        return
    }
    if (syncMessageDataChannel && syncMessageDataChannel.readyState === "open") {
        // syncState = Automerge.initSyncState();
        let msg = Uint8Array | null
        // Generate a sync message from the current doc and sync state.
        ;[syncState, msg] = Automerge.generateSyncMessage(patchHistory, syncState);
        // syncState = newSyncState; // update sync state with any changes from generating a message

        if(msg != null){
            syncMessageDataChannel.send(msg)
        }
    }
    */

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

    patchHistoryIsDirty = true
    // send doc to history app
    updateHistoryGraph()

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
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  
let numClients = 0

let patchHistoryClient
let maxMspClient
// Handle client connections
wss.on('connection', (ws, req) => {
    numClients++

    // const clientIp = req.socket.remoteAddress;
  
    console.log(`Number of clients: ${numClients}`)
    
    // Handle messages received from clients
    ws.on('message', (message) => {
        // console.log(message)
        let msg = JSON.parse(message)
        
        switch(msg.cmd){
            case 'historyWindowReady':
                
                patchHistoryClient = ws
                console.log('New Connection: patchHistoryClient')
                console.log(patchHistory)
                // send patch history to client
                updateHistoryGraph()
            break

            case 'maxStateRecall':

            break

                   //? keep this for now in case we can reuse it for other oscQuery-enabled programs
                case 'namespaceState':
                    console.log(msg.data)
                    // in this case, FP is receiving the full state of the OSC namespace in Max including the values. 
                    // i could be wrong, but i think this would always be the first changeNode in the history graph. maybe it needs to be a new changeNode type?
                    currentBranch = applyChange(currentBranch, (currentBranch) => {
                        currentBranch.openSoundControl = msg.data
                        // set the change type
                        currentBranch.changeNode = {
                            msg: 'paramUpdate',
                            param: "namespace",
                            parent: "none",
                            value: 'placeholder'
                        }
                    }, onChange, `paramUpdate namespace = placeholder`);
                break

                //? keep this for now in case we can reuse it for other oscQuery-enabled programs
                case 'OSCmsg':
                    // console.log(msg)
                    let AP = msg.data.address
                    let TTS = msg.data.args
                    
                    currentBranch = applyChange(currentBranch, (currentBranch) => {
                        if(!currentBranch.openSoundControl){
                            currentBranch.openSoundControl = {}
                        }
                        if(!currentBranch.openSoundControl[AP]){
                            currentBranch.openSoundControl[AP] = []
                        }
                        currentBranch.openSoundControl[AP] = TTS
                        // set the change type
                        currentBranch.changeNode = {
                            msg: 'paramUpdate',
                            param: AP,
                            parent: "none",
                            value: TTS
                        }
                    }, onChange, `paramUpdate ${AP} = ${TTS}`);
                break;
            case 'maxParamUpdate':
                console.log(msg)
                currentBranch = applyChange(currentBranch, (currentBranch) => {
                    if(!currentBranch.parameterSpace){
                        currentBranch.parameterSpace = {}
                    }
                    if(!currentBranch.parameterSpace[msg.param]){
                        currentBranch.parameterSpace[msg.param] = []
                    }
                    currentBranch.parameterSpace[msg.param] = msg.value
                    // set the change type
                    currentBranch.changeNode = {
                        msg: 'paramUpdate',
                        param: msg.param,
                        parent: "none",
                        value: msg.value
                    }
                }, onChange, `paramUpdate ${msg.param} = ${msg.value} $external`);

                // console.log(currentBranch.parameterSpace)

            break
            case "maxBridgeIsReady":
                maxMspClient = ws
                console.log('New Connection: maxMspClient')
            break
            case 'maxCachedState':

                // console.log(msg.data)
                // in this case, FP is receiving the full state of the OSC namespace in Max including the values. 
                // i could be wrong, but i think this would always be the first changeNode in the history graph. maybe it needs to be a new changeNode type?
                currentBranch = applyChange(currentBranch, (currentBranch) => {
                    currentBranch.parameterSpace = msg.data
                    // set the change type
                    currentBranch.changeNode = {
                        msg: 'paramUpdate',
                        param: "parameterSpace",
                        parent: "none",
                        value: 'fullState'
                    }
                }, onChange, `paramUpdate parameter state full initialization $external`);

                // console.log(currentBranch.parameterSpace)
                
            break

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

            case 'loadVersion':
                loadVersion(msg.data.hash, msg.data.branch, msg.data.gestureDataPoint, msg.data.fromSequencer)
            break


            case 'newPatchHistory':
                
                createNewPatchHistory()
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

            case 'merge':
                createMerge(msg.nodes)
                
            break
            

            // case 'updateGraph':
            //     // patchHistory = msg.patchHistory
            //     // console.log(patchHistory)
            //     updateHistoryGraph(ws, patchHistory, config.docHistoryGraphStyling)
            // break

        

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

            
            // this exists as a fallback on the client if in case the graph fails to render
            case 'requestCurrentPatchHistory':
                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'reDrawHistoryGraph',
                    data: patchHistory
                })
            break
            //     // ws.send(message)

            //     wss.clients.forEach((client) => {

            //         if (client !== ws) {
            //             console.log('sending', JSON.parse(message))
            //             client.send(JSON.stringify(msg))
            //         }
            //     });
            // break;
              
            
            default: console.log('no switch case exists for msg:', JSON.parse(message))
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

function updateHistoryGraph(){

    if (!existingHistoryNodeIDs || existingHistoryNodeIDs.size === 0){
        existingHistoryNodeIDs = new Set(historyDAG_cy.nodes().map(node => node.id()));
    }

    if(!patchHistory || !patchHistory.branchOrder) return
    const { nodes, edges, historyNodes } = buildHistoryGraph(
        patchHistory,
        existingHistoryNodeIDs,
        config.docHistoryGraphStyling
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
            if(patchHistoryClient){
                patchHistoryClient.send(JSON.stringify({
                    cmd: "forceNewPatchHistoryDueToError", 
                    message: 'Server failed to create graph; forcing a new patch history now...'
                }))
            }
        }, 1000);


        return; // prevent graph layout from running
    }
    existingHistoryNodeIDs = historyNodes

    historyDAG_cy.layout(graphLayouts[graphStyle]).run();

    // Send the graph JSON  to the patchHistory window
    const graphJSON = historyDAG_cy.json();

    if(patchHistoryClient){
        patchHistoryClient.send(JSON.stringify({
            cmd: "historyGraphRenderUpdate", 
            data: graphJSON,
            history: patchHistory
        }))
    }


    
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

    function sendMsgToHistoryApp(data) {

        if(wss.clients.size > 0){
            
            wss.clients.forEach((client) => {
                client.send(JSON.stringify(data))
            });
        }

    }

    function loadAutomergeDoc(branch){
        if (!patchHistory.docs[branch]) throw new Error(`Branchname ${branch} not found`);
        return Automerge.load(patchHistory.docs[branch]); // Load the document
    }

        function oscRecall(oscSpace){
        // ws.send(JSON.stringify({
        //     cmd: 'oscRecall',
        //     data: oscSpace
        // }))
    }

    function maxStateRecall(paramState){
        maxMspClient.send(JSON.stringify({
            cmd: 'maxStateRecall',
            data: paramState
        }))
    }
