enyo.kind({
	name: "Ares.App",
	kind: "FittableColumns",
	classes: "enyo-fit",
	handlers: {
		ondragleave: "iframeDragleave"
	},
	components: [
		{name: "client", fit: true, classes:"enyo-fit"},
		{name: "serializer", kind: "Serializer"},
		{name: "communicator", kind: "RPCCommunicator", onMessage: "receiveMessage"}
	],
	
	selection: null,
	parentInstance: null,
	containerData: null,
	aresComponents: [],
	
	create: function() {
		this.inherited(arguments);
		this.addHandlers();
		this.addDispatcherFeature();
	},
	rendered: function() {
		this.inherited(arguments);
		this.sendMessage({op: "state", val: "initialized"});
	},
	
	//* Add dispatch handling for native drag events
	addHandlers: function(inSender, inEvent) {
		document.ondragstart = enyo.dispatch;
		document.ondrag =      enyo.dispatch;
		document.ondragenter = enyo.dispatch;
		document.ondragleave = enyo.dispatch;
		document.ondragover =  enyo.dispatch;
		document.ondrop =      enyo.dispatch;
		document.ondragend =   enyo.dispatch;
	},
	/**
		Add feature to dispatcher to catch drag-and-drop-related events, and
		to stop any/all DOM events from being handled by the app.
	*/
	addDispatcherFeature: function() {
		var _this = this;
		
		enyo.dispatcher.features.push(
			function(e) {
				if (_this[e.type]) {
					_this[e.type](e)
				}
				e.preventDispatch = true;
				return true;
			}
		);
	},
	//* Send message to Deimos via _this.$.communicator_
	sendMessage: function(inMessage) {
		this.$.communicator.sendMessage(inMessage);
	},
	//* Receive message from Deimos
	receiveMessage: function(inSender, inEvent) {
		if(!inEvent.message || !inEvent.message.op) {
			enyo.warn("Deimos iframe received invalid message data:", msg);
			return;
		}
		
		var msg = inEvent.message;
		
		if(msg.op === "containerData") {
			this.setContainerData(msg.val);
		} else if(msg.op === "render") {
			this.renderKind(msg.val);
		} else if(msg.op === "select") {
			this.selectItem(msg.val);
		} else if(msg.op === "highlight") {
			this.highlightDropTarget(this.getControlById(msg.val.id));
		} else if(msg.op === "modify") {
			this.modifyProperty(msg.val);
		} else if(msg.op === "unhighlight") {
			this.unhighlightDropTargets();
		} else if(msg.op === "drop") {
			this.simulateDrop(msg.val);
		} else if(msg.op === "newControl") {
			this.simulateCreateNewComponent(msg);
		} else if(msg.op === "codeUpdate") {
			this.codeUpdate(msg.val);
		} else if(msg.op === "cleanUp") {
			this.cleanUpKind();
		} else {
			enyo.warn("Deimos iframe received unknown message op:", msg);
		}
	},
	//* On down, set _this.selection_
	down: function(e) {
		var dragTarget = this.getEventDragTarget(e.dispatchTarget);
		
		if(dragTarget && dragTarget.aresComponent) {
			this._selectItem(dragTarget);
		}
	},
	//* On drag start, set the event _dataTransfer_ property to contain a serialized copy of _this.selection_
	dragstart: function(e) {
		if(!e.dataTransfer) {
			return false;
		}
		
		e.dataTransfer.setData('Text', this.$.serializer.serializeComponent(this.selection));
        return true;
	},
	//* On drag over, enable HTML5 drag-and-drop if there is a valid drop target
	dragover: function(e) {
		var dropTarget;
		
		if(!e.dataTransfer) {
			return false;
		}
		
		dropTarget = this.getEventDropTarget(e.dispatchTarget);
		
		if(!this.isValidDropTarget(dropTarget)) {
			this.currentDropTarget = null;
			this.syncDropTargetHighlighting();
			return false;
		}

		e.preventDefault();
		
		// If dragging on current drop target, do nothing (redundant)
		if(this.currentDropTarget && this.currentDropTarget === dropTarget) {
			return false;
		}
		
		this.currentDropTarget = dropTarget;
		this.highlightDropTarget(this.currentDropTarget);
		this.syncDropTargetHighlighting();
		
		return true;
	},
	//* On drag leave, unhighlight previous drop target
	dragleave: function(e) {
		var dropTarget;
		
		if(!e.dataTransfer) {
			return false;
		}
		
		dropTarget = this.getEventDropTarget(e.dispatchTarget);

		if(!this.isValidDropTarget(dropTarget)) {
			return false;
		}
		
		this.currentDropTarget = null;
		this.unHighlightItem(dropTarget);
		this.syncDropTargetHighlighting();
		
		return true;
	},
	/**
		On drop, either move _this.selection_ or create a new component (if
		dragged component came from outside of iFrame and thus doesn't have an id).
	*/
	drop: function(e) {
		var dropData,
			dropTarget;
		
		if(!e.dataTransfer) {
			return false;
		}
		
		dropTarget = this.getEventDropTarget(e.dispatchTarget);
		
		if(!this.isValidDropTarget(dropTarget)) {
			return false;
		}
		
		dropData = enyo.json.codify.from(e.dataTransfer.getData("Text"));
		
		this.currentDropTarget = null;
		
		if(dropData.id) {
			this.dropControl(this.getControlById(dropData.id), dropTarget);
		} else if(dropData.op && dropData.op === "newControl") {
			this.createNewComponent(dropData, dropTarget);
		}
		
		this.syncDropTargetHighlighting();
		
        return true;
	},
	
	//* Save _inData_ as _this.containerData_ to use as a reference when creating drop targets.
	setContainerData: function(inData) {
		this.containerData = inData;
		this.sendMessage({op: "state", val: "ready"});
	},
	//* Render the specified kind
	renderKind: function(inKindName) {
		var kindConstructor = enyo.constructorForKind(inKindName);
		
		if(!kindConstructor) {
			this.log("No constructor exists for ", inKindName);
			return;
		} else if(!kindConstructor.prototype) {
			this.log("No prototype exists for ", inKindName);
			return;
		}
		
		// Clean up after previous kind
		if(this.parentInstance) {
			this.cleanUpPreviousKind();
		}
		
		// Save this kind's _kindComponents_ array
		this.aresComponents = this.flattenKindComponents(kindConstructor.prototype.kindComponents);
		
		// Enable drag/drop on all of _this.aresComponents_
		this.makeAresComponentsDragAndDrop();
		
		// Save reference to the parent instance currently rendered
		this.parentInstance = this.$.client.createComponent({kind: inKindName}).render();
		
		// Notify Deimos that the kind rendered successfully
		this.kindUpdated();
	},
	//* When the designer is closed, clean up the last rendered kind
	cleanUpKind: function() {
		// Clean up after previous kind
		if(this.parentInstance) {
			this.cleanUpPreviousKind();
			this.parentInstance = null;
		}
		
	},
	//* Clean up previously rendered kind
	cleanUpPreviousKind: function() {
		// Save changes made to components into previously rendered kind's _kindComponents_ array
		enyo.constructorForKind(this.parentInstance.kind).prototype.kindComponents = enyo.json.codify.from(this.$.serializer.serialize(this.parentInstance));
		
		// Reset flags on previously rendered kind's _kindComponents_ array
		this.unflagAresComponents();
		
		// Clear previously rendered kind
		this.$.client.destroyClientControls();
	},
	/**
		Response to message sent from Deimos. Highlight the specified conrol
		and send a message with a serialized copy of the control.
	*/
	selectItem: function(inItem) {
		for(var i=0, c;(c=this.flattenChildren(this.$.client.children)[i]);i++) {
			if(c.id === inItem.id) {
				this._selectItem(c);
				return;
			}
		}
	},
	//* Update _this.selection_ property value based on change in Inspector
	modifyProperty: function(inData) {
		this.selection[inData.property] = inData.value;
		this.refreshClient(true);
	},
	//* When a drop happens in the component view, translate that to a drop in this iframe.
	simulateDrop: function(inDropData) {
		var dropTarget = this.getControlById(inDropData.target);
		
		if(this.isValidDropTarget(dropTarget)) {
			this.dropControl(this.getControlById(inDropData.item), dropTarget);
		}
	},
	//* When an item is dragged from the Palette to the ComponentView, translate that to create a component in this iframe.
	simulateCreateNewComponent: function(inDropData) {
		var dropTarget = this.getControlById(inDropData.target);
		
		if(this.isValidDropTarget(dropTarget)) {
			this.createNewComponent(inDropData, dropTarget);
		}
	},
	
	//* Get each kind component individually
	flattenKindComponents: function(inComponents) {
		var ret = [],
			cs,
			c;
		
		if(!inComponents) {
			return ret;
		}
		
		for (var i=0;(c = inComponents[i]);i++) {
			ret.push(c);
			if(c.components) {
				cs = this.flattenKindComponents(c.components);
				for (var j=0;(c = cs[j]);j++) {
					ret.push(c);
				}
			}
		}
		
		return ret;
	},
	// TODO - merge this with flattenKindComponents()
	flattenChildren: function(inComponents) {
		var ret = [],
			cs,
			c;
		
		for (var i=0;(c = inComponents[i]);i++) {
			ret.push(c);
			if(c.children) {
				cs = this.flattenChildren(c.children);
				for (var j=0;(c = cs[j]);j++) {
					ret.push(c);
				}
			}
		}
		
		return ret;
	},
	
	//* Set up drag and drop attributes for all kind components
	makeAresComponentsDragAndDrop: function() {
		for(var i=0,child;(child = this.aresComponents[i]);i++) {
			this.makeComponentDragAndDrop(child);
		}
	},
	//* Set up drag and drop for _inComponent_
	makeComponentDragAndDrop: function(inComponent) {
		this.makeComponentDraggable(inComponent);
		this.makeComponentADropTarget(inComponent);
		this.flagAresComponent(inComponent);
	},
	//* Add the attribute _draggable="true"_ to _inComponent_
	makeComponentDraggable: function(inComponent) {
		if(inComponent.attributes) {
			inComponent.attributes.draggable =  true;
		} else {
			inComponent.attributes = {
				draggable:  true
			};
		}
	},
	/**
		Add the attribute _dropTarget="true"_ to _inComponent_ if it wasn't explicitly set
		to false in the design.js file (works as an opt out).
	*/
	makeComponentADropTarget: function(inComponent) {
		if(inComponent.attributes) {
			inComponent.attributes.dropTarget = (this.containerData[inComponent.kind] !== false);
		} else {
			inComponent.attributes = {
				dropTarget: (this.containerData[inComponent.kind] !== false)
			};
		}
	},
	flagAresComponent: function(inComponent) {
		inComponent.aresComponent = true;
	},
	//* Remove _aresComponent_ flag from previously used _this.aresComponents_ array
	unflagAresComponents: function() {
		for(var i=0, component;(component = this.aresComponents[i]);i++) {
			delete component.aresComponent;
		}
	},
	
	isValidDropTarget: function(inControl) {
		return (inControl && inControl !== this.selection && !inControl.isDescendantOf(this.selection));
	},
	getControlById: function(inId) {
		for(var i=0, c;(c=this.flattenChildren(this.$.client.children)[i]);i++) {
			if(c.id === inId) {
				return c;
			}
		}
	},
	
	getEventDragTarget: function(inComponent) {
		return (!inComponent) ? null : (!this.isDraggable(inComponent)) ? this.getEventDragTarget(inComponent.parent) : inComponent;
	},
	getEventDropTarget: function(inComponent) {
		return (!inComponent) ? null : (inComponent === this.parentInstance) ? this.parentInstance : (!this.isDropTarget(inComponent)) ? this.getEventDropTarget(inComponent.parent) : inComponent;
	},
	isDraggable: function(inComponent) {
		return (inComponent.attributes && inComponent.attributes.draggable);
	},
	isDropTarget: function(inComponent) {
		return (inComponent.attributes && inComponent.attributes.dropTarget);
	},
	
	//* Highlight _inComponent_ with drop target styling, and unhighlight everything else
	highlightDropTarget: function(inComponent) {
		this.unhighlightDropTargets();
		if(typeof inComponent.origBackground === "undefined") {
			inComponent.origBackground = inComponent.domStyles.background || null;
			inComponent.applyStyle("background","#cedafe");
		}
	},
	//* Highlight _this.selection_ with selected styling, and unhighlight everything else
	highlightSelection: function() {
		this.unhighlightDropTargets();
		if(typeof this.selection.origBackground === "undefined") {
			this.selection.origBackground = this.selection.domStyles.background || null;
			this.selection.applyStyle("background","orange");
		}
	},
	unhighlightDropTargets: function() {
		for(var i=0, c;(c=this.flattenChildren(this.$.client.children)[i]);i++) {
			if(c !== this.selection) {
				this.unHighlightItem(c);
			}
		}
	},
	unHighlightItem: function(inComponent) {
		if(typeof inComponent.origBackground !== "undefined") {
			inComponent.applyStyle("background", inComponent.origBackground);
			inComponent.origBackground = undefined;
		}
	},
	syncDropTargetHighlighting: function() {
		var dropTarget = this.currentDropTarget ? this.$.serializer.serializeComponent(this.currentDropTarget) : null;
		this.sendMessage({op: "syncDropTargetHighlighting", val: dropTarget});
	},
	//* Set _inItem_ to _this.selected_ and notify Deimos
	_selectItem: function(inItem) {
		this.selection = inItem;
		this.highlightSelection();
		this.sendMessage({op: "select", val: this.$.serializer.serializeComponent(this.selection)});
	},
	/**
		Create an object copy of the _inDroppedControl_, then destroy and recreate it
		as a child of _inTargetControl_
	*/
	dropControl: function(inDroppedControl, inTargetControl) {
		var droppedControlCopy = this.getSerializedCopyOfComponent(inDroppedControl),
			newComponent;
		
		inDroppedControl.destroy();
		
		// Create a clone of the moved control
		newComponent = inTargetControl.createComponent(droppedControlCopy, {owner: this.parentInstance});
		
		// Make sure all moved controls are draggable/droppable as appropriate
		this.setupControlDragAndDrop(newComponent);
		
		this.refreshClient();
		
		// Maintain selected state
		this._selectItem(newComponent);
	},
	/**
		Find any children in _inControl_ that match kind components of the parent instance,
		and make them drag/droppable (if appropriate)
	*/
	setupControlDragAndDrop: function(inControl) {
		var childComponents = this.flattenChildren(inControl.children),
			i,
			j;
		
		this.makeComponentDragAndDrop(inControl);
		
		for(i=0;i<childComponents.length;i++) {
			for(j=0;j<this.aresComponents.length;j++) {
				if(childComponents[i].id === this.aresComponents[j].id) {
					this.makeComponentDragAndDrop(childComponents[i]);
				}
			}
		}
	},
	/**
		Create a new component, brought in from the Palette. This component's initial properties
		are defined in the design.js file associated with the current library.
	*/
	createNewComponent: function(inNewComponent, inDropTarget) {
		var newComponent = inDropTarget.createComponent(inNewComponent, {owner: this.parentInstance});
		
		// Add the new component to _this.aresComponents_ for future reference
		this.aresComponents.push(newComponent);
		
		// Make sure all moved controls are draggable/droppable as appropriate
		this.setupControlDragAndDrop(newComponent);
		
		// If we have a placeholder name, set it accordingly
		if(newComponent.getContent() === "$name") {
			newComponent.setContent(newComponent.name);
		}
		
		this.refreshClient();
		// Select the newly added item
		this._selectItem(newComponent);
	},
	//* Create object that is a copy of the passed in component
	getSerializedCopyOfComponent: function(inComponent) {
		return enyo.json.codify.from(this.$.serializer.serializeComponent(inComponent));
	},
	//* Rerender client and (optionally) notify Deimos
	refreshClient: function(noMessage) {
		this.$.client.render();
		if(!noMessage) {
			this.kindUpdated();
		}
	},
	//* Send update to Deimos with serialized copy of current kind component structure
	kindUpdated: function() {
		this.sendMessage({op: "rendered", val: this.$.serializer.serialize(this.parentInstance)});
	},
	//* Eval code passed in by designer
	codeUpdate: function(inCode) {
		eval(inCode);
	}
});