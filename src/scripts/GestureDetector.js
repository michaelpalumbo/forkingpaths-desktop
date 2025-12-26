export class GestureDetector {
    // Pass the param name here
    constructor(paramName, onGestureComplete) {
        this.paramName = paramName; 
        this.onGestureComplete = onGestureComplete;
        this.currentGesture = [];
        this.isActive = false;
    }

    input(value) {
        this.isActive = true;
        this.currentGesture.push({
            val: value,
            time: Date.now()
        });
    }

    stop() {
        if (!this.isActive || this.currentGesture.length === 0) return;

        // Return BOTH the name and the data
        this.onGestureComplete(this.paramName, this.currentGesture);

        this.currentGesture = [];
        this.isActive = false;
    }
}