
/* Library for sync targets
 */

function import_link (link, isBrowser) {

	// initialisation of global variables
	if (!isBrowser) {
		webLinks.push(link);
	}

	// should be called only once
	link.init = function () {
		if (link._init) {
			link._init(); // should also be called only once
		}

		if (link != browser) {
			// start if enabled
			if (localStorage[link.shortname+'_enabled']) {
				link.enable();
			}
		}
	};

	link.updateStatus = function (status) {
		// ??? to use my object (this), I have to use 'link' instead of 'this'.
		if (status !== undefined) {
			link.status = status;
		}
		if (link == browser) return; // not in popup
		if (!is_popup_open) return;

		// make make human-readable message
		var msgtext = 'Not synchronized';
		if (link.enabled) {
			if (link.status == statuses.READY) {
				msgtext = 'Synchronized';
			} else if (link.status == statuses.AUTHORIZING) {
				msgtext = 'Authorizing...';
			} else if (link.status == statuses.DOWNLOADING) {
				msgtext = 'Downloading...';
			} else if (link.status == statuses.PARSING) {
				msgtext = 'Parsing bookmarks data...';
			} else if (link.status == statuses.MERGING) {
				msgtext = 'Syncing...';
			} else if (link.status == statuses.UPLOADING) {
				msgtext = 'Uploading ('+((link.queue||link.r_queue).length+1)+' left)...';
			} else {
				msgtext = 'Enabled, but unknown status (BUG! status='+link.status+')';
			}
		}
		var btn_start = !link.enabled || !link.status && link.enabled;
		var btn_stop  = link.enabled && !link.status;

		var message = {action: 'updateUi', shortname: link.shortname, message: msgtext, btn_start: btn_start, btn_stop: btn_stop};

		// send message to specific browsers
		if (browser.name == 'chrome') {
			chrome.extension.sendRequest(message, function () {});
		} else if (browser.name == 'firefox') {
			if (is_popup_open) {
				current_document.getElementById('sync2all-'+link.shortname+'-status').value = msgtext;
				current_document.getElementById('sync2all-'+link.shortname+'-button-start').disabled = !btn_start;
				current_document.getElementById('sync2all-'+link.shortname+'-button-stop').disabled  = !btn_stop;
			}
		} else if (browser.name == 'opera') {
			opera.extension.broadcastMessage(message);
		}
	}

	link.mark_state_deleted = function (state) {

		// remove the subfolders first
		var title;
		for (title in state.f) {
			var substate = state.f[title];
			this.mark_state_deleted(substate);
		}

		// then remove the bookmarks
		// Otherwise, non-empty folders will be removed
		for (var i=0; data=state.bm[i]; i++) {

			var id, url;
			data = data.split('\n');
			id = data[0]; url = data[1];

			// this bookmark has been removed
			console.log('Bookmark deleted: '+url);
			this.actions.push(['bm_del', id]);
		}

		// remove the parent folder when the contents has been deletet
		this.actions.push(['f_del_ifempty', state.id]); // clean up empty folders
	}
	link.onRequest = function (request, sender, sendResponse) {
		// handle request
		if (request.action.substr(0, link.shortname.length+1) == link.shortname+'_') {
			link['msg_'+request.action.substr(request.action.indexOf('_')+1)](request, sender);
		}
	}
	if (browser.name == 'chrome') {
		chrome.extension.onRequest.addListener(link.onRequest);
	} else if (browser.name == 'firefox') {
	}

	link.may_save_state = function () {
		if (browser.queue.running ||
			link.has_saved_state ||
			link.status ||
			!link.save_state) {
			return;
		}

		if ((link.queue || link.r_queue).running) {
			console.warn(link.shortname+': '+'Queue is running but status is zero!');
			console.log(link);
			return; // will be started when the queue is empty
		}

		link.has_saved_state = true;

		console.log(link.shortname+': saving state:');
		console.trace();
		link.save_state();
	};

	// like link.start, but only called when it is not already enabled
	link.enable = link.msg_enable = function () {
		// don't re-enable
		if (link.enabled) return;

		if (link.status) {
			console.error('Target is not enabled but status is non-zero! (BUG!):');
			console.log(link);
			delete localStorage.opl_enabled; // just to be sure
			alert('There is a bug in Opera Link. Opera Link is now disabled. See the log for details.');
			return;
		}

		// mark enabled
		// This also prevents that this link is started twice unneeded
		link.enabled = true;
		// don't do these things for the browser link, they are only meant for
		// the links to extern sources
		if (link != browser) {
			localStorage[link.shortname+'_enabled'] = true;
			enabledWebLinks.push(link);
		}

		// clear variables
		link.has_saved_state = false;

		// now start the link. Should be done when it is enabled
		link.start();
	};

	// Stop Opera Link, but leave status information
	link.stop = function () {
		delete localStorage[link.shortname+'_enabled'];
		link.enabled = false;
		if (link != browser) {
			Array_remove(enabledWebLinks, link);
		}
		Array_remove(finishedLinks, link);

		link.updateStatus(statuses.READY);
	};

	// remove memory-eating status information and stop
	// This will be called from the popup.
	link.msg_disable = link.disable = function () {
		delete localStorage[link.shortname+'_state'];
		link.stop();
	};

	link.status = statuses.READY; // only to initialize


};


function import_queue (obj) {

	/* variables */

	obj.queue = [];
	obj.queue.id = Math.random();


	/* functions */


	// add a function to the queue
	obj.queue_add = function (callback, data) {
		this.queue.push([callback, data]);
	};

	// start walking through the queue if it isn't already started
	obj.queue_start = function () {
		if (this.queue.running) {
			console.warn('Queue is already running! '+this.queue.id+this.queue.running);
			return;
		}
		this.updateStatus(statuses.UPLOADING);
		this.queue.running = true;
		this.queue_next();
	};

	// execute the next function in the queue
	obj.queue_next = function () {
		try {
			var queue_item = this.queue.shift();
			if (!queue_item) {

				// queue has finished!
				this.queue_stop();

				// don't go further
				return;
			}

			// send amount of lasting uploads to the popup
			this.updateStatus(statuses.UPLOADING);

			var callback = queue_item[0];
			var data     = queue_item[1];
			callback(data);
		} catch (err) {
			console.error('queue_next');
			console.trace();
			throw (err);
		}

	};

	obj.queue_stop = function () {
		// queue has been finished!!!
		this.queue.running = false;
		this.queue.length = 0; // for when the queue has been forced to stop, clear the queue

		this.updateStatus(statuses.READY);
		console.log(this.name+' has finished the queue!!! '+this.queue.id+this.queue.running);

		// save current state when everything has been uploaded
		// this occurs also when there is nothing in the queue when the
		// first commit happens.
		this.may_save_state();

		// if this is the browser
		if (this == browser) {
			// save all states when they are ready
			call_all('may_save_state');
		}
	};
	obj.queue_error = function () {
		// disable link on error
		this.queue_stop();
		this.stop();
	}
}

// implement a queue of XMLHttpRequests for a given object
function import_rqueue(obj) {

	// variables
	obj.r_queue= []; // remote queue (list of [payload, callback])

	// functons

	obj.r_queue_add = function (url, payload, callback) {
		var req = new XMLHttpRequest();
		req.open("POST", url, true);
		req.url = url; // only for me, not for the request
		var params = '';
		var key;
		for (key in payload) {
			params += (params?'&':'')+key+'='+encodeURIComponent(payload[key]);
		}
		this.r_queue_add_req(req, params, callback);
	};

	obj.r_queue_add_req = function (req, params, callback) {
		this.r_queue.push([req, params, callback]);
		if (!this.r_queue.running) {
			this.r_queue.running = true;
			this.updateStatus(statuses.UPLOADING);
			this.r_queue_next();
		}
	};

	obj.r_queue_next = function () {

		if (this.r_queue.length == 0) {
			console.log('Finished uploading');
			this.r_queue.running = false;
			this.updateStatus(statuses.READY); // update popup with 'finished' count

			// save my own state when it is finished
			this.may_save_state();

			// save current state when everything has been uploaded
			if (this.initial_commit) {
				this.save_state();
			}
			return;
		}

		// update the popup with the new 'left' count
		this.updateStatus(statuses.UPLOADING);

		var req      = this.r_queue[0][0];
		var params   = this.r_queue[0][1];
		var callback = this.r_queue[0][2];
		this.r_queue.shift();
		var obj = this;
		req.onreadystatechange = function () {
			if (req.readyState != 4) return; // not loaded
			// request completed

			if (req.status != 200) {
				console.error('Request failed, status='+req.status+', url='+req.url+', params='+params);
			}
			if (callback) callback(req);
			obj.r_queue_next(); // do the next push
		}
		req.send(params);
	};
}

/** Called when something has been moved. This is an utility function for
 * browser objects.
 */
function move_event (link, id, oldParentId, newParentId) {
	// get info
	var node      = link.ids[id];
	var oldParent = link.ids[oldParentId];
	var newParent = link.ids[newParentId];

	// if the bookmark has been moved by Sync2all, ignore this event
	if (node && newParent && node.parentNode == newParent) {
		return;
	}

	// if node is moved to outside synced folder
	if (!newParent) {
		// if the node comes from outside the synced folder
		if (!oldParent) {
			if (!node) {
				console.log('Bookmark/folder outside synchronized folder moved. Ignoring.');
				return;
			} else {
				console.log('BUG: only the node is known, not the rest \
						(including the parent!)');
				return;
			}
		} else { // the 'else' is not really needed
			if (!node) {
				console.log('BUG: only the old parent is known, not the node \
						nor the new parent');
				return;
			} else {
				// newParent is not known, node and oldParent are known.
				console.log('Move: new parent not found. Thus this bookmark/folder is \
						moved to outside the synced folder.');

				// remove the node
				delete link.ids[node.id];
				rmNode(link, node); // parent needed for bookmarks
				commit()
				return;
			}
		}
	} else {
		// the node is moved to inside the synced folder
		if (!node) {
			// the node is moved from outside the synced folder to therein.
			if (!oldParent) { // check it twice, should also be undefined.

				console.log('Move: node id and oldParent not found. I assume this \
bookmark comes from outside the synchronized tree. So doing a crete now');
				link.import_node(id);
				commit();
				return;
			} else {
				console.log('BUG: the node is not known, but the old parent \
						and the new parent are.');
				return;
			}
		} else {
			if (!oldParent) {
				console.log('BUG: only the old parent is not known. The node \
						and the new parent are.');
				return;
			} else {
				// the bookmark has been moved within the synced folder tree.
				// Nothing strange has happened.
			}
		}
	}

	// newParent, node and oldParent are 'defined' variables. (i.e. not
	// 'undefined').

	if (newParent == oldParent) {
		// node moved inside folder (so nothing has happened, don't know
		// whether this is really needed, Chrome might catch this).
		return;
	}

	
	// Bookmark is moved inside synced folder.

	node.parentNode = newParent;

	if (node.url) {
		// bookmark
		console.log('Moved '+node.url+' from '+(oldParent?oldParent.title:'somewhere in the Other Bookmarks menu')+' to '+newParent.title);
		newParent.bm[node.url] = node;
		delete oldParent.bm[node.url];
		call_all('bm_mv', link, [node, oldParent]);
	} else {
		// folder
		if (newParent.f[node.title]) {
			console.log('FIXME: duplicate folder overwritten (WILL FAIL AT SOME POINT!!!)');
		}
		newParent.f[node.title] = node;
		delete oldParent.f[node.title];
		call_all('f_mv', link, [node, oldParent]);
	}
	commit();
}
