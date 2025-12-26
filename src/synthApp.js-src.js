//*
//*
//* INITIALIZATION AND SETUP
//* Set up dependencies, initialize core variables
//*
// const ws = new WebSocket('ws://localhost:3000');

export const forceBundle = true;

// const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
// const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws`);

// Use the correct protocol based on your site's URL
const WS_URL = "ws://127.0.0.1:3001"

import { saveDocument, loadDocument, deleteDocument } from '../utilities/indexedDB.js';



import { fromByteArray, toByteArray } from 'base64-js';
  
// Create the RTCPeerConnection.
let syncMessageDataChannel;
let peerPointerDataChannel

let thisPeerID

// * History Sequencer
let currentIndex = 0;
let patchHistoryWindow;

// shared sequencer settings (shared between peers)
let sharedSequencerState = null

// * new automerge implementation




let collaborationSettings = {
    local: {
        versionRecallMode: null
    },
    remotePeer: {
        versionRecallMode: null
    }
}

let patchHistoryIsDirty = false


// store param changes belonging to a single param within a gesture as a list     
let groupChange = { }

// *
// *
// *    APP
// *
// *

document.addEventListener("DOMContentLoaded", function () {

    /*
    let automergeRunning = false
 
    //* AUTOMERGE IMPLEMENTATION
    async function startAutomerge() {

        // if patchHistory doesn't contain a document, create a new one
        if (!patchHistory.docs[patchHistory.head.branch]) {

            currentBranch = Automerge.init();

            // load synthFile from indexedDB
            if (patchHistory.synthFile) {
                createNewPatchHistory(patchHistory.synthFile)
            } else {
                console.log("No synth file found. currentBranch initialized but not changed.");
                previousHash = null;

                try {
                        // Fetch the Demo Synth
                    const response = await fetch(`/assets/synths/${import.meta.env.VITE_FIRST_SYNTH}.fpsynth`);
                    
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    
                    // Parse the response as JSON
                    const fileContent = await response.json();
                    
                    // Store the JSON string in localStorage if needed
                    localStorage.setItem('synthFile', JSON.stringify(fileContent));
                    
                    // Process the JSON content
                    createNewPatchHistory(fileContent);
            
                    // enable new history button now that a synth has been loaded
                    // UI.menus.file.newPatchHistory.disabled = false
                  
                } catch (error) {
                    console.error("Error loading template file:", error);
                }
           

            
                // patchHistory = Automerge.change(patchHistory, (patchHistory) => {
                //     // Only set up empty branch patchHistorydata — no doc yet
                //     patchHistory.branches[config.patchHistory.firstBranchName] = {
                //         head: null,
                //         root: null,
                //         parent: null,
                //         history: []
                //     };
                //     patchHistory.head.branch = config.patchHistory.firstBranchName;
                //     patchHistory.head.hash = null;
                //     patchHistory.branchOrder.push(config.patchHistory.firstBranchName);
                // });
            }

            //!
        } else {

            // patchHistory does contain at least one document, so grab whichever is the one that was last looked at
            currentBranch = Automerge.load(patchHistory.docs[patchHistory.head.branch]);

            // wait 1 second before loading content (give the audio worklet a moment to load)
            setTimeout(()=>{
                updateSynthWorklet('loadVersion', currentBranch.synth.graph, null, currentBranch.type)

                updateCytoscapeFromDocument(currentBranch, 'buildUI');
                
                previousHash = patchHistory.head.hash
                
                // send doc to history app
                reDrawHistoryGraph()

                // load the draw canvas
                if(currentBranch.drawing){
                    loadCanvasVersion(currentBranch.drawing)
                }
    
            }, 1000);
        }
    }

    */
    
    // Set an interval to periodically save patchHistory to IndexedDB
    setInterval(async () => {
       
        // if(patchHistory && syncMessageDataChannel && syncMessageDataChannel.readyState === 'closed'){
        if(patchHistory && docUpdated){
            // await saveDocument(docID, Automerge.save(currentBranch));
            await saveDocument(patchHistoryKey, Automerge.save(patchHistory));
            docUpdated = false
        }

    }, config.indexedDB.saveInterval);

    // handle document changes and call a callback
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


                
                updatePatchHistoryDatabase()

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

                updatePatchHistoryDatabase()
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

       
        // update the historyGraph
        reDrawHistoryGraph()


    };

    function paramChange(parentNode, paramLabel, value){

        updateSynthWorklet('paramChange', {
            parent: parentNode,
            param: paramLabel,
            value: value,
        });


       
            // clear the groupChange object
            groupChange = {}
            // set new groupChange
            groupChange.parentNode = parentNode
            groupChange.paramLabel = paramLabel
            groupChange.values = [value],
            groupChange.timestamps = [new Date().getTime()]

            //! important: see the 'mouseup' event listener in this script (not the synthGraphCytoscape. one, the one for the entire DOM) for how paramChanges are handled by automerge. 

       
        
    }

    // a peer has created a new patch history, so update our patch history from that one and do all the same synth building stuff as createNewPatchHistory
    function replacePatchHistory(newDocBinary){

        // deletes the document in the indexedDB instance
        // deleteDocument(docID)
        deleteDocument('patchHistory')
        
        // clear the sequences
        sendMsgToHistoryApp({
            appID: 'forkingPathsMain',
            cmd: 'newPatchHistory'
                
        })
        // tell server renderer to clear the history graph
        ws.send(JSON.stringify({
            cmd: 'clearHistoryGraph'
        }))
        
        patchHistory = Automerge.load(newDocBinary);
        // Also reset syncState with this new doc
        syncState = Automerge.initSyncState();

        // send doc to history app
        reDrawHistoryGraph()

        // load the new state (which should always just be the blank patch)
        // send 'fromPeer' so we don't trigger a version recall on the other peers 
        loadVersion(patchHistory.head.hash, patchHistory.head.branch, 'fromPeer')


    }
    function createNewPatchHistory(synthFile, fromPeer){


        // delete the document in the indexedDB instance
        deleteDocument('patchHistory')

        // clear the sequencer
        sendMsgToHistoryApp({
            appID: 'forkingPathsMain',
            cmd: 'newPatchHistory'
                
        })
        // tell server to erase the patchHistory & send a blank DAG to client(s)
        ws.send(JSON.stringify({
            cmd: 'clearHistoryGraph'
        }))
        
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

        let hash = Automerge.getHeads(currentBranch)[0]
        previousHash = hash

        let msg = 'initial_state'

        patchHistory = Automerge.change(patchHistory, (patchHistory) => {
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
        sendDataChannelMessage(message)
    }
    

    /*
        DOCUMENT HISTORY CYTOSCAPE (DAG)
    */
 
    function reDrawHistoryGraph(){
        patchHistoryIsDirty = true

        sendMsgToHistoryApp({
            appID: 'forkingPathsMain',
            cmd: 'reDrawHistoryGraph',
            data: patchHistory
                
        })
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
       
        updateSynthWorklet('loadVersion', currentBranch.synth.graph)

        updateCytoscapeFromDocument(currentBranch, 'buildUI');

        // update the historyGraph
        reDrawHistoryGraph()



    }

    async function loadVersionWithGestureDataPoint(targetHash, branch, gestureDataPoint){

        let requestedDoc = loadAutomergeDoc(branch)

        // Use `Automerge.view()` to view the state at this specific point in history
        const historicalView = Automerge.view(requestedDoc, [targetHash]);
        let tempMutableView = JSON.parse(JSON.stringify(historicalView));
        
        let updatedView = updateTempMutableView(tempMutableView, gestureDataPoint.parent, gestureDataPoint.param, Number(gestureDataPoint.value))

        console.log('need to pass along the gesture datapoints (see code above this line)')

    }
    // Load a version from the DAG
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

    } 


    function sendDataChannelMessage(message){
        if(syncMessageDataChannel.readyState === 'open'){
            syncMessageDataChannel.send(JSON.stringify(message));
        }
    }
    //*
    //*
    //* SYNCHRONIZATION
    //* Functions related to custom network and sync handling.
    //*
    

    function sendSyncMessage() {
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

    }

    function updateFromSyncMessage(branch, hash){
        if(!branch){
            console.log('no branch')
            branch = patchHistory.head.branch
        }

        if(!hash){
            console.log('no hash')
            hash = patchHistory.head.hash
        }
        // set docUpdated so that indexedDB will save it
        docUpdated = true
                // // need the branch
        // // need the current hash
        let requestedDoc = loadAutomergeDoc(branch)
        // Use `Automerge.view()` to view the state at this specific point in history
        const updatedView = Automerge.view(requestedDoc, [hash]);

        // IMPORTANT: when more than 1 peer is in room, gesture changes will cause the first gesture value to appear instead of the last due to sync states bouncing around
        if(updatedView.changeNode && updatedView.changeNode.msg === 'gesture' && syncMessageDataChannel.readyState === 'open'){

            // get the last value of the gesture
            let lastValue = {
                parent: updatedView.changeNode.parent,
                param: updatedView.changeNode.param,
                value: updatedView.changeNode.values[updatedView.changeNode.values.length - 1],
            }

            let tempGraph = updatedView.synth.graph

            tempGraph.modules[lastValue.parent].params[lastValue.param][0] = lastValue.value
            // send as paramUpdate to audio worklet
            updateSynthWorklet('loadVersion', tempGraph);
            // send as update to knob overlay
            updateCytoscapeFromDocument(updatedView, 'buildFromSyncMessage', lastValue)
        } else {
            // update them as normal
            updateSynthWorklet('loadVersion', updatedView.synth.graph, null, updatedView.changeNode)

            updateCytoscapeFromDocument(updatedView, 'buildFromSyncMessage')
        }

        // update the historyGraph
        reDrawHistoryGraph()

        // update local branch
        currentBranch = Automerge.clone(updatedView)




    }

    function getVersionRecallMode() {
        let mode = localStorage.getItem('versionRecallMode') || 'openLoadVersion';
        collaborationSettings.local.versionRecallMode = mode
        
        return mode
    }

    // 
    function openVersionRecall(hash, branch) {
        if (!syncMessageDataChannel || syncMessageDataChannel.readyState !== 'open') {
            return;
        }
      
        const message = {
            cmd: 'version_recall_open',
            hash,
            branch,
            from: thisPeerID
        };
      
        sendDataChannelMessage(message)
      
    }
      

//*
//*
//* webRTC COMMUNICATION
//* Functions that communicate between main app and server
//*   

    // ICE server configuration (using a public STUN server)
    const configuration = {
        iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
        // Optionally add TURN servers here
        ]
    };
    
    // Create the RTCPeerConnection.
    const peerConnection = new RTCPeerConnection(configuration);

    // Helper function to send signaling messages using the "newPeer" command.
    function sendSignalingMessage(message) {
        // Wrap message in an object with cmd 'newPeer'
        const payload = JSON.stringify({ cmd: 'newPeer', msg: message, peerID: thisPeerID });
        ws.send(payload);
    }
    
    // --- ICE Candidate Handling ---
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendSignalingMessage({ candidate: event.candidate });
        }
    };

    // --- Data Channel Handling ---
    // If you're the initiating peer, you'll create the data channel.
    // Otherwise, listen for the remote data channel.
    peerConnection.ondatachannel = event => {
        const channel = event.channel;
        channel.binaryType = 'arraybuffer';
        if (channel.label === "syncChannel" || channel.label === "myDataChannel") {
            syncMessageDataChannel = channel;
            setupDataChannel(syncMessageDataChannel);
        } else if (channel.label === "peerPointerChannel") {
            peerPointerDataChannel = channel;
            setupPeerPointerDataChannel(peerPointerDataChannel);
        }
    };
    

    // Function to set up the data channel events.
    function setupDataChannel() {
        syncMessageDataChannel.onopen = () => {
            console.log('connected with peer')
            const message = {
                cmd: 'remotePeerCollaborationSettings',
                from: thisPeerID,
                data: collaborationSettings
            };
            sendDataChannelMessage(message)

            // also send the current sharedSequencerState to the remote peer
            if(sharedSequencerState){
                console.log(sharedSequencerState)
                console.log('\n\nsending sharedSequencerState to remote peer')

                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'syncPeerSequencer',
                    action: 'sharedSequencerState',
                    data: sharedSequencerState
                })
                
                // console.log(sharedSequencerState)
                // sendDataChannelMessage({
                //     cmd: 'sharedSequencerState',
                //     payload: sharedSequencerState
                // })
                // sendMsgToHistoryApp({
                //     appID: 'forkingPathsMain',
                //     cmd: 'sequencerModificationCheck',
                    // data: {
                    //     action: 'syncSequencerOnNewPeerConnection',
                    //     payload: sharedSequencerState
                    // }
 
                // })
            } else {
                // ask history app if sequencer has been modified at all in this session, if it has, it will bundle the state and send back here to be passed along to the peer
                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'sequencerModificationCheck' 
                })
            }


            // ensure that new peer loads the current state. 
            // const msg = {
            //     cmd: 'currentState',
            //     from: thisPeerID,
            //     data: [newPeerHash, newPeerBranch]
            // };
            // syncMessageDataChannel.send(JSON.stringify(msg));

            forceReload(false)
            sendSyncMessage()
        };
        syncMessageDataChannel.onmessage = event => {
            let incomingData;
            // handle Custom JSON messages (like version recalls, merge requests, etc.)
            if (typeof event.data === "string") {
                try {
                    const msg = JSON.parse(event.data);
                    try {
                        switch (msg.cmd) {

                            

                            case 'replacePatchHistory':
                                const newDocBinary = toByteArray(msg.data);

                                replacePatchHistory(newDocBinary)
                            break
                            case 'newPatchHistory':
                                createNewPatchHistory(null, 'fromPeer')
                            break

                            case 'version_recall_open': 
                                loadVersion(msg.hash, msg.branch, 'fromPeer');
                                // highlight the version's node in the history graph
                                sendMsgToHistoryApp({
                                    appID: 'forkingPathsMain',
                                    cmd: 'highlightHistoryNode',
                                    data: msg.hash
                                })
                            break;
                        
                        
                            case 'version_recall_mode_announcement':
                                const remoteMode = msg.mode;
                                UI.panel.collaboration.recallMode.remote.innerText = `Remote peer mode: ${remoteMode}`;
                        
                                collaborationSettings.remotePeer.versionRecallMode = remoteMode;
                                
                            break;

                            case 'remotePeerCollaborationSettings':
                                collaborationSettings.remotePeer.versionRecallMode = msg.data.local.versionRecallMode
                                // UI.panel.collaboration.recallMode.remote.innerText = `Remote peer mode: ${msg.data.local.versionRecallMode}`;

                                showSnackbar(`Peer ${msg.from} joined this session`, 3000)
                            break

                            case 'currentState':
                                newPeerHash =  msg.data[0]
                                newPeerBranch =  msg.data[1]
                            break

                            case 'syncPeerSequencer':
                                
                                // relay the message to the history app
                                sendMsgToHistoryApp({
                                    appID: 'forkingPathsMain',
                                    cmd: msg.cmd,
                                    data: msg
                                })
                            break

                            case 'sharedSequencerState':
                                // store the sequencer state
                                sharedSequencerState = msg.payload

                                console.log(sharedSequencerState)
                                // if history window is open, send the sequencer state
                                sendMsgToHistoryApp({
                                    appID: 'forkingPathsMain',
                                    cmd: 'syncPeerSequencer',
                                    action: 'sharedSequencerState',
                                    data: sharedSequencerState
                                })

                            break
                  
                        default:
                            console.warn("Unknown custom message cmd:", msg.cmd);
                        }
                    } catch (err) {
                        console.error("Error handling JSON message:", err);
                    }
                } catch (err) {
                    console.error("Failed to parse custom JSON message:", event.data);
                }
        
                return; // Do not proceed to Automerge sync handling
            }
            // handle binary blobs (automerge sync messages)
            if (event.data instanceof ArrayBuffer) {
                incomingData = new Uint8Array(event.data);

            } else {
                console.error("Expected ArrayBuffer but got:", event.data);
                return;
            }

            try {
                [patchHistory, syncState] = Automerge.receiveSyncMessage(patchHistory, syncState, incomingData);
                
                const syncBranch = patchHistory.head?.branch;
                const syncHash = patchHistory.head?.hash;
                // const syncBranch = newPeerBranch || patchHistory.head?.branch;
                // const syncHash = newPeerHash || patchHistory.head?.hash;
                
                // clear newPeer branch and Hash
                // newPeerBranch = null
                // newPeerHash = null

                if (syncBranch && syncHash && patchHistory.docs?.[syncBranch]) {
                    updateFromSyncMessage(syncBranch, syncHash);

                    // After processing, check if there is an outgoing sync message to send.
                    sendSyncMessage();

                } else {
                    console.warn("Sync message received but state incomplete — skipping update.");
                    location.reload()
                }

            } catch (error) {
                console.error("Error processing sync message:", error);
            }
        };
    }
    

    function setupPeerPointerDataChannel(channel) {
        channel.onopen = () => {
            // You could send an initial message if needed:
            // channel.send(JSON.stringify({ type: 'pointerInit', data: ... }));
        };
        channel.onmessage = event => {
            let msg = JSON.parse(event.data)
            switch(msg.viewport){

                case 'patchHistoryWindow':
                    // console.log('remote peer mouse pos in patchHistory window', msg.payload)
                    sendMsgToHistoryApp({
                        appID: 'forkingPathsMain',
                        cmd: 'remotePeerHistoryMousePosition',
                        data: msg
                    })
                    
                break
            }
            
            // if (event.data instanceof ArrayBuffer) {
            //     incomingData = new Uint8Array(event.data);
            //     // Process pointer messages accordingly.
            //     console.log("Received peer pointer data:", incomingData);
            //     // For example, convert to JSON (if you sent JSON as binary) or handle as needed.
            // } else {
            //     console.error("Expected ArrayBuffer on peer pointer channel but got:", event.data);
            // }
        };
    }

    

    // --- Initiating Connection ---
    // This function is called when you want this client to start the connection.
    async function initiateConnection() {
        // Create the sync channel (for Automerge sync)
        syncMessageDataChannel = peerConnection.createDataChannel("syncChannel");
        setupDataChannel();
        
        // Create the peer pointer channel (for pointer messages)
        peerPointerDataChannel = peerConnection.createDataChannel("peerPointerChannel");
        setupPeerPointerDataChannel(peerPointerDataChannel);
        
        // Create an SDP offer.
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        // Send the offer through the signaling channel.
        sendSignalingMessage(offer);
    }
    
//*
//*
//* SERVER COMMUNICATION
//* Functions that communicate between main app and server
//*

    let ws
    let reconnectInterval = 1000;
    let retryAttempts = 0
    function connectWebSocket() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('Connected to WebSocket server at', WS_URL);

            if(retryAttempts > 0){
                showSnackbar('Server connection successful. Resuming history graph updates', 10000)
                retryAttempts = 0
            }
            reconnectInterval = 1000; // reset interval on successful reconnect
            ws.send(JSON.stringify({
                cmd: 'joinRoom',
                peerID: thisPeerID,
                room: room
            }));

            ws.send(JSON.stringify({
                cmd: 'getRooms'
            }))

            initiateConnection().catch(err => console.error("Error initiating connection:", err))
        };
        
        ws.onmessage = async (event) => {
            let msg = JSON.parse(event.data)
            
            switch(msg.cmd){

                //! ignore these. they are bootstraps and we can delete these once we merge synthapp.js with server.js for the native version of fp2
                case 'maxStateRecall':
                    // do nuthin
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
                break;

                case 'maxCachedState':
                    console.log(msg.data)
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
                    }, onChange, `paramUpdate $external`);
                break

                // we've received a parameter update from a 3rd party (i.e. a max patch)
                case "externalParamUpdate":
                    // console.log(msg)

                    // currentBranch = applyChange(currentBranch, (currentBranch) => {
                    //     // currentBranch.synth.graph.modules[groupChange.parentNode].params[groupChange.paramLabel] = groupChange.values[0];
                    //     // set the change type
                    //     currentBranch.changeNode = {
                    //         msg: 'paramUpdate',
                    //         param: msg.param,
                    //         parent: "none",
                    //         value: msg.args
                    //     }
                    // }, onChange, `paramUpdate ${msg.param} = ${msg.value}`);
                break;

                case 'newPatchHistoryDatabaseID':

                    patchHistory = Automerge.change(patchHistory, (patchHistory) => {
                        patchHistory.databaseID = msg.patchHistoryId
                    })

                
                    sendMsgToHistoryApp({
                        appID: 'forkingPathsMain',
                        cmd: msg.cmd,
                        data: msg
                            
                    })
            
                break



                case 'newPeer':
                    const peerMessage = JSON.parse(msg.msg).msg
                    UI.panel.collaboration.remotePeerUsername.textContent = JSON.parse(msg.msg).peerID;

                    // Process the signaling message based on its type.
                    if (peerMessage.type === 'offer') {
                        // Received an offer: set it as the remote description.
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(peerMessage));
                        // Create an answer and set as local description.
                        const answer = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answer);
                        // Send the answer via the signaling channel.
                        sendSignalingMessage(answer);
                    } else if (peerMessage.type === 'answer') {

                        // Received an answer for our offer.
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(peerMessage));
                    } else if (peerMessage.candidate) {
                        // Received an ICE candidate.
                        try {
                        await peerConnection.addIceCandidate(peerMessage.candidate);
                        } catch (err) {
                        console.error("Error adding ICE candidate:", err);
                        }
                    }
                break


                case 'forceNewPatchHistoryDueToError':
                    createNewPatchHistory()
                    console.log('\n\n** forced create new patch history due to error ** \n\n')

                break

                default: console.warn('no switch case exists for message:', msg)
            }
        }

        ws.onclose = () => {
            console.log('WebSocket disconnected. Attempting to reconnect...');
            setTimeout(connectWebSocket, reconnectInterval);
        };

        ws.onerror = (err) => {
            retryAttempts++
            if(retryAttempts === 2){
                showSnackbar('Server connection error. History graph updates paused. Entered Offline Mode', 10000)
            }
            console.error('WebSocket error:', err.message);
            ws.close(); // Triggers onclose for reconnect
        };

    }

    connectWebSocket()

//*
//*
//* APP COMMUNICATION
//* Functions that communicate between main app and history app 
//*


    
    // Example: Send graph data to the history tab
    function sendMsgToHistoryApp(data) {
        if (patchHistoryWindow && !patchHistoryWindow.closed) {
            patchHistoryWindow.postMessage(data, '*');
        } else {

        }
    }
    
    //! these will be moved to the server.js' WS
    // Listen for messages from the history window
    window.addEventListener('message', (event) => {
        if(!event.data.cmd){
            // console.log('missing cmd from:', event.data)
            return
        }
        
        switch(event.data.cmd){

            case 'remotePeerHistoryMousePosition':
                if (peerPointerDataChannel && peerPointerDataChannel.readyState === "open") {
                    peerPointerDataChannel.send(JSON.stringify({
                        viewport: 'patchHistoryWindow',
                        peerID: thisPeerID,
                        action: 'position',
                        payload: event.data.payload
                    }))
                }
            break

            case 'remotePeerHistoryMouseClick':
                if (peerPointerDataChannel && peerPointerDataChannel.readyState === "open") {
                    peerPointerDataChannel.send(JSON.stringify({
                    viewport: 'patchHistoryWindow',
                    peerID: thisPeerID,
                    action: 'click',
                }))
                }

            break

            

            case 'requestCurrentPatchHistory':
                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'reDrawHistoryGraph',
                    data: patchHistory
                })
            break

            case 'syncPeerSequencer':
                if(event.data.action === 'syncSequencerOnNewPeerConnection'){
                    
                    sharedSequencerState = event.data.payload
                }
                // // send the sequencer update to remote peer
                sendDataChannelMessage(event.data)



            break
            case 'historyWindowReady':
                console.log(thisPeerID, room)
                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'reDrawHistoryGraph',
                    data: patchHistory,
                    // room: room
                })

                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'setRoom',
                    room: room
                })
                // // get room info (which includes the sequencer state of the remote peer)
                // ws.send(JSON.stringify({
                //     cmd: 'getSequencerState'
                // }))
                
                // sendMsgToHistoryApp({
                //     appID: 'forkingPathsMain',
                //     cmd: 'syncPeerSequencer',
                //     action: 'syncSequencerOnNewPeerConnection',
                //     payload: sharedSequencerState
                // })
                
                // if we have a remote peer and that peer has a sequencer state, send it to the local history window
                // if(sharedSequencerState){

                // sendMsgToHistoryApp({
                //     appID: 'forkingPathsMain',
                //     cmd: 'sequencerModificationCheck',
                //     // data: {
                //     //     action: 'syncSequencerOnNewPeerConnection',
                //     //     payload: sharedSequencerState
                //     // }
 
                // })
            // }
                
                
            break

            // case 'newPatchHistory':
                
            //     //? send a message to peer(s) to clear their patch history
            //     // if createNewPatchHistory() was called from the syncMessageDataChannel, don't send out the message (aka, another peer already initiated the new patchHistory)
            
            //     // console.log('sending new patchHistory')
            //     // const message = {
            //     //     cmd: 'newPatchHistory',
            //     //     from: thisPeerID
            //     // };
            
            //     // sendDataChannelMessage(message)
              
            // break

            case 'savePatchHistory':

                const patch_binary = fromByteArray(Automerge.save(patchHistory))

                ws.send(JSON.stringify({
                    cmd: 'savePatchHistory',
                    data: {
                        name: 'my new patch history',
                        authors: [ ...patchHistory.authors, thisPeerID ],
                        description: 'Created during a jam with PeerX',
                        modules: ['Oscillator_Lemur', 'Filter_Antique'], // can be pulled from your patch graph
                        synth_template: patchHistory.synthFile, // JSON object
                        patch_binary: patch_binary, // base64-encoded string
                        forked_from_id: patchHistory.forked_from_id, // or null if this is a root version
                    }
                }))
            break
            case 'loadPatchHistory':
    
                if(event.data.source === 'file'){
                    
                    loadPatchHistory(event.data.arrayBuffer)
                } else {
                    console.log('trying to load patchHistory from database', event.data)
                    // load it from the database
                    let entry = event.data.data

                    // const historyFromDB = Automerge.load(binary);

                    loadPatchHistory(entry.patch_binary.data, entry.id)
                    
                }





            break
            case 'loadVersion':
                loadVersion(event.data.data.hash, event.data.data.branch, event.data.data.gestureDataPoint, event.data.data.fromSequencer)
            break

            case 'loadVersionWithGestureDataPoint':
                loadVersionWithGestureDataPoint(event.data.data.hash, event.data.data.branch, event.data.data.gestureDataPoint)
            break
            
            case 'saveSequence':

                currentBranch = applyChange(currentBranch, (currentBranch) => {
                    // set the sequencer table data
                    if(!currentBranch.sequencer){
                        currentBranch.sequencer = {
                            tableData: []
                        }
                    }
                    currentBranch.sequencer.tableData = event.data.data
                    // set the change type
                    currentBranch.changeNode = {
                        msg: 'sequence',
                        tableData: event.data.data,
                        timestamp: new Date().getTime()
                    }
                }, onChange, `sequence todo:sequenceNaming tableData:${JSON.stringify(event.data.data)}`);

            break
            case 'updateSequencer':
                // sometimes on load, Automerge isn't running before this is called:
                if(Automerge){
                    patchHistory = Automerge.change(patchHistory, (patchHistory) => {
                        patchHistory.sequencer = event.data.data
                    });
                }


                // sharedSequencerState = event.data.data

            break

            case 'merge':
                createMerge(event.data.nodes)
                
            break

            case 'hydrateGesture':
                // we've recalled a sequence node into the entire sequencer, so hydrate the sequencerData.gestures array in the patchHistory.js
                let hydratedDoc = loadAutomergeDoc(event.data.data.branch)

                // Use `Automerge.view()` to view the state at this specific point in history
                const hydratedView = Automerge.view(hydratedDoc, [event.data.data.hash]);

                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'hydrateGesture',
                    data: hydratedView.changeNode,   
                    index: event.data.data.index   
                })
            break

            case 'getGestureData':
                // get the head from this branch
                let head = patchHistory.branches[event.data.data.branch].head

                let gestureDoc = loadAutomergeDoc(event.data.data.branch)

                // Use `Automerge.view()` to view the state at this specific point in history
                const gestureView = Automerge.view(gestureDoc, [event.data.data.hash]);
                
                let recallGesture = false
                if(event.data.data.cmd === 'recallGesture'){
                    recallGesture = true
                }

                sendMsgToHistoryApp({
                    appID: 'forkingPathsMain',
                    cmd: 'getGestureData',
                    data: gestureView.changeNode,
                    recallGesture: recallGesture
                        
                })
            break
            case 'playGesture':
                const node = event.data.data
                const data = {
                    parent: node.parent,
                    param: node.param, 
                    value: node.value,
                    kind: node.kind
                }
                updateSynthWorklet('paramChange', data)

                // set param value visually
                let paramID = `paramControl_parent:${data.parent}_param:${data.param}`
                const paramElement = UI.synth.visual.paramControls[node.parent][node.param];
                paramElement.value = data.value;
                // for all non-menu UIs
                if(event.data.kind != 'menu'){
                    $(paramElement).val(data.value).trigger('change');
                }


            break

            case 'cloneGesture':
                let msg = event.data.data

           
                // prepare to create a new branch from the position of the parentNode, which is the node just before the start of the gesture we are cloning
                let requestedDoc = loadAutomergeDoc(msg.parentNode.branch)

                // Use `Automerge.view()` to view the state at this specific point in history
                const historicalView = Automerge.view(requestedDoc, [msg.parentNode.id]);

                let clonedDoc = Automerge.clone(historicalView)

                automergeDocuments.current = {
                    doc: clonedDoc
                }
                // set newClone to true
                automergeDocuments.newClone = true

                currentBranch = applyChange(currentBranch, (currentBranch) => {
                    currentBranch.synth.graph.modules[msg.assignTo.parent].params[msg.assignTo.param] = msg.scaledValues;
                    
                    // set the change type
                    currentBranch.changeNode = {
                        msg: 'gesture',
                        param: msg.assignTo.param,
                        parent: msg.assignTo.parent,
                        values: msg.scaledValues,
                        timestamps: msg.timestamps
                    }
                }, onChange, `gesture ${msg.assignTo.param}$PARENT ${msg.assignTo.parent}`);
            break

            default: console.warn('switch case doesnt exist for:', event.data.cmd)
        }

    });

//*
//*
//* EVENT HANDLERS
//* Functions that directly handle UI interactions
//*

    
    //! the following (in the 'else if') can be used to segment gestures probably
    // Listen for mouse up event on the document
    document.addEventListener('mouseup', function(event) {

        
        // if the user has been playing with a param knob, we need to store it as a param change (or list of param changes) in automerge
        if(Object.keys(groupChange).length > 0){
            // if we are storing a single param change, do a paramUpdate
            if(groupChange.values.length === 1){
                // change is singular
                // Update in Automerge
                currentBranch = applyChange(currentBranch, (currentBranch) => {
                    currentBranch.synth.graph.modules[groupChange.parentNode].params[groupChange.paramLabel] = groupChange.values[0];
                  
                    // set the change type
                    currentBranch.changeNode = {
                        msg: 'paramUpdate',
                        param: groupChange.paramLabel,
                        parent: groupChange.parentNode,
                        value: groupChange.values
                    }
                }, onChange, `paramUpdate ${groupChange.paramLabel} = ${groupChange.values[0]}$PARENT ${groupChange.parentNode}`);

            } else if(groupChange.values.length > 1){
                // are storing a gesture
                // Update in Automerge
                currentBranch = applyChange(currentBranch, (currentBranch) => {
                    currentBranch.synth.graph.modules[groupChange.parentNode].params[groupChange.paramLabel] = groupChange.values;
               
                    // set the change type
                    currentBranch.changeNode = {
                        msg: 'gesture',
                        param: groupChange.paramLabel,
                        parent: groupChange.parentNode,
                        values: groupChange.values,
                        timestamps: groupChange.timestamps
                    }
                }, onChange, `gesture ${groupChange.paramLabel}$PARENT ${groupChange.parentNode}`);

            }

            // clear the groupChange
            groupChange = { }
        }

        


    });


   


    



    
    
    
    


    function loadPatchHistory(arrayBuffer, forkedFromID){

            ws.send(JSON.stringify({
                cmd: 'clearHistoryGraph'
            }))
            // clear the sequences
            // console.warn('now that history window is issuing the loadPatchHistory logic, consider having this next step be client-side (i.e. no need to wait for main app to send the message on the next line here:')
            // sendMsgToHistoryApp({
            //     appID: 'forkingPathsMain',
            //     cmd: 'newPatchHistory'
                    
            // })




            // Example: Load into Automerge

            // Convert to Uint8Array (required for Automerge.load)
            const binaryData = new Uint8Array(arrayBuffer);
            patchHistory = Automerge.load(binaryData);
            
            // get latest branch
            let latestBranch = patchHistory.branchOrder[patchHistory.branchOrder.length - 1]

            currentBranch = Automerge.load(patchHistory.docs[latestBranch])

            oscRecall(currentBranch.openSoundControl)

            // recall max patch state
            maxStateRecall(currentBranch.parameterSpace)
            
            previousHash = patchHistory.head.hash
            
            reDrawHistoryGraph()

            if(forkedFromID){

                patchHistory = Automerge.change(patchHistory, d => {
                    d.databaseID = forkedFromID
                    // d.forked_from_id = forkedFromID; // numeric DB ID of the parent
                    // d.authors = [ ...patchHistory.authors, thisPeerID ]
                    d.hasBeenModified = false
                });

            }
            saveDocument(patchHistoryKey, Automerge.save(patchHistory));

            // store history in database??
    }
        
    
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

    function loadAutomergeDoc(branch){
        if (!patchHistory.docs[branch]) throw new Error(`Branchname ${branch} not found`);
        return Automerge.load(patchHistory.docs[branch]); // Load the document
    }

    // messages to historyCy throttling
    setInterval(() => {
        throttleSend = false
        if(patchHistoryIsDirty){
            sendMsgToHistoryApp({
                appID: 'forkingPathsMain',
                cmd: 'reDrawHistoryGraph',
                data: patchHistory
                    
            })
        }

        patchHistoryIsDirty = false
    }, config.appCommunication.throttleInterval); // Attempt to send updates every interval



    let forceReloadTimeoutID


    function setRoomInfo(){
        room = roomDetails.room

        sendMsgToHistoryApp({
            appID: 'forkingPathsMain',
            cmd: 'setRoom',
            room: room
        })

        // get automerge running!
        if(!automergeRunning){
            // set room info in collab panel
            UI.panel.collaboration.roomInfo.textContent = room;

            // patchHistoryKey
            patchHistoryKey = room ? `patchHistory-${room}` : 'patchHistory';
            // startup automerge 
            
        }

    }


    function oscRecall(oscSpace){
        // ws.send(JSON.stringify({
        //     cmd: 'oscRecall',
        //     data: oscSpace
        // }))
    }

    function maxStateRecall(paramState){
        ws.send(JSON.stringify({
            cmd: 'maxStateRecall',
            data: paramState
        }))
    }

    
});


