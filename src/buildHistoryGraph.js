/**
 * Generates nodes and edges for a history graph.
 *
 * @param {Object} patchHistory - Metadata containing branch order and history details.
 * @param {Set} existingHistoryNodeIDs - Set of existing node IDs to avoid duplicates.
 * @param {Object} docHistoryGraphStyling - Styling information for nodes.
 * @returns {Object} - An object containing nodes, edges, and updated existingHistoryNodeIDs.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const historyGraphYIncrement = 75

function buildHistoryGraph(patchHistory, existingHistoryNodeIDs, docHistoryGraphStyling) {

    const outputPath = join(__dirname, 'patchHistory.json');
    // writeFileSync(outputPath, JSON.stringify(patchHistory, null, 2));
    const nodes = [];
    const edges = [];

    const nodeIdToYPos = new Map();
    const branchRootY = new Map();

    // Pass 1: calculate branch root Y positions
    patchHistory.branchOrder.forEach((branchName, branchIndex) => {
    const branch = patchHistory.branches[branchName];
    const firstItem = branch.history[0];
    let y;

    if (firstItem && firstItem.parent) {
        const parentId = Array.isArray(firstItem.parent) ? firstItem.parent[0] : firstItem.parent;
        const parentY = nodeIdToYPos.get(parentId);
        y = parentY !== undefined ? parentY : 0;
    } else {
        y = 0; // root branch
    }

        branchRootY.set(branchName, y);
    });

    const plannedYPositions = new Map();

    patchHistory.branchOrder.forEach(branchName => {
        const branch = patchHistory.branches[branchName];
        const firstItem = branch.history[0];

        let rootY = 0;

        if (firstItem && firstItem.parent) {
            const parentId = Array.isArray(firstItem.parent)
            ? firstItem.parent[0]
            : firstItem.parent;

            const parentY = plannedYPositions.get(parentId);
            rootY = parentY !== undefined ? parentY : 0;
        }

        branch.history.forEach((item, i) => {
                const y = rootY - (i + 1) * historyGraphYIncrement;
                plannedYPositions.set(item.hash, y);
            });
    });


 


    // Accessing branches in order, create nodes and edges for each branch
    patchHistory.branchOrder.forEach((branchName, branchIndex) => {
        const branch = patchHistory.branches[branchName];
        const rootY = branchRootY.get(branchName);
        // Iterate over each history item in the branch
        branch.history.forEach((item, nodeIndex) => {
            const nodeId = item.hash;

            if (existingHistoryNodeIDs.has(nodeId)) return;

            const yPos = plannedYPositions.get(item.hash);
            
            nodeIdToYPos.set(nodeId, yPos);

            let label;
            let parent = []
            let sequencerTable 
            let mergeData
            let paramData
            // we now store the parent module data in the change message, so extract that so it doesn't appear as the label, and place it in the 'parent' prop
            // check if its a $PARENT or $PARENTS condition
            if(item.msg.includes('$PARENT ')){
                
                parent = item.msg.split('$PARENT ')[1]
                label = `${item.msg.split('$PARENT ')[0]} ${parent.split('_')[0]}_${parent.split('_')[1]}`
            } else if (item.msg.includes("$PARENTS ")){
                label = item.msg.split('$PARENTS ')[0]
                parent = item.msg.split('$PARENTS ')[1]
            } else if (item.msg.includes('.fpsynth')){
                label = `loaded ${item.msg}`
                // parent = []
            } else if(item.msg.includes('sequence')){
                label = item.msg.split('tableData:')[0]
                sequencerTable = JSON.parse(item.msg.split('tableData:')[1])
            }
            else if(item.msg.includes('draw')){
                label = item.msg
                // sequencerTable = JSON.parse(item.msg.split('tableData:')[1])
            }
            else if(item.msg.includes('loaded')){
                label = item.msg
                // sequencerTable = JSON.parse(item.msg.split('tableData:')[1])
            }
            else if(item.msg.includes('merge')){
                label = item.msg
                mergeData = {
                    parents: item.parent,
                    nodes: item.nodes
                }
                // sequencerTable = JSON.parse(item.msg.split('tableData:')[1])
            }

            else if(item.msg.includes('$external')){
                label = item.msg
                console.log(item)
                paramData = {

                }
                // mergeData = {
                //     parents: item.parent,
                //     nodes: item.nodes
                // }
                // sequencerTable = JSON.parse(item.msg.split('tableData:')[1])
            }

            const newNode = {
                group: "nodes",
                data: {
                    id: nodeId,
                    label: label,
                    color: docHistoryGraphStyling.nodeColours[item.msg.split(" ")[0]] || "#ccc",
                    branch: branchName,
                    parents: parent || null,
                    sequencerTable: sequencerTable || null,
                    timeStamp: item.timeStamp,
                    mergeData: mergeData || null,
                    peer: item.peer || null

                },
                // Add a manual position!
                position: {
                    x: branchIndex * 110, // horizontal slot per branch
                    y: yPos   // stack nodes top to bottom
                }
                
                
            }

            
            // Add node to the history graph
            nodes.push(newNode);

            // Add the newly added node's ID to the set to track it
            existingHistoryNodeIDs.add(nodeId);
            
        });
    });

    // now that all nodes are made, create their edges

    patchHistory.branchOrder.forEach((branchName) => {
        const branch = patchHistory.branches[branchName];

        // Iterate over each history item in the branch
        branch.history.forEach((item) => {
            const nodeId = item.hash;

            // ! this is where we'll also figure out how to deal with 2 parents in the case of a merge!
            // If the history item has a parent, add an edge to connect the parent
            if (item.parent) {
                // first check if item.parent is an array. if it is, then this node is a merge between 2 parents
                if(Array.isArray(item.parent)){
                    item.parent.forEach((parent, index)=>{
                        edges.push({
                            group: "edges",
                            data: {
                                id: `${item.parent[index]}_to_${nodeId}`,
                                source: item.parent[index],
                                target: nodeId,
                            },
                        });
                    })
                } else {
                                // //Make sure the parent node also exists before adding the edge
                // if (existingHistoryNodeIDs.has(item.parent)) {
                    edges.push({
                        group: "edges",
                        data: {
                            id: `${item.parent}_to_${nodeId}`,
                            source: item.parent,
                            target: nodeId,
                        },
                    });
                }
            }
            
        });

        
    });

    return { nodes, edges, existingHistoryNodeIDs };
}

export default buildHistoryGraph;
  