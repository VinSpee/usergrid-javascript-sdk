/**
*  This module is a collection of classes designed to make working with
*  the Appigee App Services API as easy as possible.
*  Learn more at http://apigee.com/docs/usergrid
*
*   Copyright 2012 Apigee Corporation
*
*  Licensed under the Apache License, Version 2.0 (the "License");
*  you may not use this file except in compliance with the License.
*  You may obtain a copy of the License at
*
*      http://www.apache.org/licenses/LICENSE-2.0
*
*  Unless required by applicable law or agreed to in writing, software
*  distributed under the License is distributed on an "AS IS" BASIS,
*  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*  See the License for the specific language governing permissions and
*  limitations under the License.
*
*  @author rod simpson (rod@apigee.com)
*/

//authentication type constants
var AUTH_CLIENT_ID = 'CLIENT_ID';
var AUTH_APP_USER = 'APP_USER';
var AUTH_NONE = 'NONE';

Client = function(options) {
  //usergrid enpoint
  this.URI = 'https://api.usergrid.com';

  //Find your Orgname and Appname in the Admin portal (http://apigee.com/usergrid)
  this.orgName = options.orgName;
  this.appName = options.appName;

  //authentication data
  this.authType = options.authType || AUTH_NONE;
  this.clientId = options.clientId;
  this.clientSecret = options.clientSecret;
  this.token = options.token || null;
  this.user = null;

  //other options
  this.buildCurl = options.buildCurl || false;
  this.logging = options.logging || false;

  //timeout and callbacks
  this._callTimeout =  options.callTimeout || 30000; //default to 30 seconds
  this._callTimeoutCallback =  options.callTimeoutCallback || null;
  this.logoutCallback =  options.logoutCallback || null;

};

/**
*  Main function for making requests to the API.  Can be called directly.
*
*  options object:
*  `method` - http method (GET, POST, PUT, or DELETE), defaults to GET
*  `qs` - object containing querystring values to be appended to the uri
*  `body` - object containing entity body for POST and PUT requests
*  `endpoint` - API endpoint, for example 'users/fred'
*  `mQuery` - boolean, set to true if running management query, defaults to false
*
*  @method request
*  @public
*  @params {object} options
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Client.prototype.request = function (options, callback) {
  var self = this;
  var method = options.method || 'GET';
  var endpoint = options.endpoint;
  var body = options.body || {};
  var qs = options.qs || {};
  var mQuery = options.mQuery || false; //is this a query to the management endpoint?
  if (mQuery) {
    var uri = this.URI + '/' + endpoint;
  } else {
    var uri = this.URI + '/' + this.orgName + '/' + this.appName + '/' + endpoint;
  }

  //add client auth if required
  if (self.authType === AUTH_CLIENT_ID) {
    qs['client_id'] = self.clientId;
    qs['client_secret'] = self.clientSecret;
  }

  //append params to the path
  var encoded_params = encodeParams(qs);
  if (encoded_params) {
    uri += "?" + encoded_params;
  }

  //stringify the body object
  body = JSON.stringify(body);

  //so far so good, so run the query
  var xhr = new XMLHttpRequest();
  xhr.open(method, uri, true);
  //add content type = json if there is a json payload
  if (body) {
    xhr.setRequestHeader("Content-Type", "application/json");
  }
  if (self.authType === AUTH_APP_USER) {
    xhr.setRequestHeader("Authorization", "Bearer " + self.token);
    xhr.withCredentials = true;
  }

  // Handle response.
  xhr.onerror = function() {
    self._end = new Date().getTime();
    if (self.logging) {
      console.log('success (time: ' + self.calcTimeDiff() + '): ' + method + ' ' + uri);
    }
    if (self.logging) {
      console.log('Error: API call failed at the network level.')
    }
    //network error
    clearTimeout(timeout);
    var err = true;
    if (typeof(callback) === 'function') {
      callback(err, data);
    }
  };

  xhr.onload = function(response) {
    //call timing, get time, then log the call
    self._end = new Date().getTime();
    if (self.logging) {
      console.log('success (time: ' + self.calcTimeDiff() + '): ' + method + ' ' + uri);
    }
    //call completed
    clearTimeout(timeout);
    //decode the response
    response = JSON.parse(xhr.responseText);
    if (xhr.status != 200)   {
      //there was an api error
      var error = response.error;
      var error_description = response.error_description;
      if (self.logging) {
        console.log('Error ('+ xhr.status +')(' + error + '): ' + error_description )
      }
      if ( (error == "auth_expired_session_token") ||
           (error == "unauthorized")   ||
           (error == "auth_missing_credentials")   ||
           (error == "auth_invalid")) {
        //this error type means the user is not authorized. If a logout function is defined, call it
        //if the user has specified a logout callback:
        if (typeof(self.logoutCallback) === 'function') {
          return self.logoutCallback(true, response);
        }
      }
      if (typeof(callback) === 'function') {
        callback(true, response);
      }
    } else {
      if (typeof(callback) === 'function') {
        callback(false, response);
      }
    }
  };

  var timeout = setTimeout(
    function() {
      xhr.abort();
      if (self._callTimeoutCallback === 'function') {
        self._callTimeoutCallback('API CALL TIMEOUT');
      } else {
        self.callback('API CALL TIMEOUT');
      }
    },
    self._callTimeout); //set for 30 seconds

  if (this.logging) {
    console.log('calling: ' + method + ' ' + uri);
  }
  this._start = new Date().getTime();
  xhr.send(body);
}

Client.prototype.createEntity = function (data, callback) {
  var options = {
    client:this,
    data:data
  }
  var entity = new Entity(options);
  entity.save(function(err, data) {
    if (typeof(callback) === 'function') {
      callback(err, entity);
    }
  });
}


Client.prototype.createCollection = function (options, callback) {
  options.client = this;
  var collection = new Collection(options, function(err, data) {
    if (typeof(callback) === 'function') {
      callback(err, collection);
    }
  });

}


/**
*  A private method to get call timing of last call
*/
Client.prototype.calcTimeDiff = function () {
 var seconds = 0;
 var time = this._end - this._start;
 try {
    seconds = ((time/10) / 60).toFixed(2);
 } catch(e) { return 0; }
 return seconds;
}

/*
*  A public method to log in an app user - stores the token for later use
*
*  @method login
*  @public
*  @params {string} username
*  @params {string} password
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Client.prototype.login = function (username, password, callback) {
  var self = this;
  var options = {
    method:'GET',
    endpoint:'token',
    qs:{
      username: username,
      password: password,
      grant_type: 'password'
    }
  };
  this.request(options, function(err, data) {
    var user = {};
    if (err && self.logging) {
      console.log('error trying to log user in');
    } else {
      user = new Entity('users');
      user.set(data.user);
      self.user = user;
      self.token = data.access_token;
    }
    if (typeof(callback) === 'function') {
      callback(err, data, user);
    }
  });
}

/**
*  A public method to test if a user is logged in - does not guarantee that the token is still valid,
*  but rather that one exists, and that there is a valid UUID
*
*  @method isLoggedIn
*  @public
*  @return {boolean} Returns true the user is logged in (has token and uuid), false if not
*/
Client.prototype.isLoggedIn = function () {
  var user = this.user;
  var haveUser = (user && this.token);
  if (!haveUser) {
    return false;
  }
  if (!isUUID(user.get('uuid'))) {
    return false;
  }
  return true;
}

/*
*  A private method to build the curl call to display on the command line
*
*  @method buildCurlCall
*  @private
*  @param {object} options
*  @return {string} curl
*/
Client.prototype.buildCurlCall = function (options) {
  var curl = 'curl';
  var method = (options.method || 'GET').toUpperCase();
  var body = options.body || {};
  var uri = options.uri;

  //curl - add the method to the command (no need to add anything for GET)
  if (method === 'POST') {curl += ' -X POST'; }
  else if (method === 'PUT') { curl += ' -X PUT'; }
  else if (method === 'DELETE') { curl += ' -X DELETE'; }
  else { curl += ' -X GET'; }

  //curl - append the path
  curl += ' ' + uri;

  //curl - add the body
  body = JSON.stringify(body)
  if (body !== '{}') {
    //curl - add in the json obj
    curl += " -d '" + body + "'";
  }

  //log the curl command to the console
  console.log(curl);

  return curl;
}

/**
*  A public method to log out an app user - clears all user fields from client
*
*  @method logout
*  @public
*  @return none
*/
Client.prototype.logout = function () {
  this.user = null;
  this.token = null;
}

/**
*  A class to Model a Usergrid Entity.
*  Set the type of entity in the 'data' json object
*
*  @constructor
*  @param {object} options {client:client, data:{'type':'collection_type', 'key':'value'}, uuid:uuid}}
*/
Entity = function(options) {
  this._client = options.client;
  this._data = options.data || {};
};

/**
*  gets a specific field or the entire data object. If null or no argument
*  passed, will return all data, else, will return a specific field
*
*  @method get
*  @param {string} field
*  @return {string} || {object} data
*/
Entity.prototype.get = function (field) {
  if (field) {
    return this._data[field];
  } else {
    return this._data;
  }
}

/**
*  adds a specific key value pair or object to the Entity's data
*  is additive - will not overwrite existing values unless they
*  are explicitly specified
*
*  @method set
*  @param {string} key || {object}
*  @param {string} value
*  @return none
*/
Entity.prototype.set = function (key, value) {
  if (typeof key === 'object') {
    for(var field in key) {
      this._data[field] = key[field];
    }
  } else if (typeof key === 'string') {
    if (value === null) {
      delete this._data[key];
    } else {
      this._data[key] = value;
    }
  } else {
    this._data = null;
  }
}

/**
*  Saves the entity back to the database
*
*  @method save
*  @public
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Entity.prototype.save = function (callback) {
  //TODO:  API will be changed soon to accomodate PUTs via name which create new entities
  //       This function should be changed to PUT only at that time, and updated to use
  //       either uuid or name
  var type = this.get('type');
  var method = 'POST';
  if (isUUID(this.get('uuid'))) {
    method = 'PUT';
    type += '/' + this.get('uuid');
  }

  //update the entity
  var self = this;
  var data = {};
  var entityData = this.get();
  //remove system specific properties
  for (var item in entityData) {
    if (item === 'metadata' || item === 'created' || item === 'modified' ||
        item === 'type' || item === 'activatted' ) { continue; }
    data[item] = entityData[item];
  }
  var options =  {
    method:method,
    endpoint:type,
    body:data
  };
  //save the entity first
  this._client.request(options, function (err, retdata) {
    if (err && self._client.logging) {
      console.log('could not save entity');
      if (typeof(callback) === 'function') {
        return callback(err, retdata, self);
      }
    } else {
      if (retdata.entities.length) {
        var entity = retdata.entities[0];
        self.set(entity);
      }
      //if this is a user, update the password if it has been specified;
      var needPasswordChange = (type === 'users' && entityData.oldpassword && entityData.newpassword);
      if (needPasswordChange) {
        //Note: we have a ticket in to change PUT calls to /users to accept the password change
        //      once that is done, we will remove this call and merge it all into one
        var pwdata = {};
        pwdata.oldpassword = entityData.oldpassword;
        pwdata.newpassword = entityData.newpassword;
        this._client.request(
          {
            method:'PUT',
            endpoint:type,
            body:pwdata
          },
          function (err, data) {
            if (err && self._client.logging) {
              console.log('could not update user');
            }
            //remove old and new password fields so they don't end up as part of the entity object
            self.set('oldpassword', null);
            self.set('newpassword', null);
            if (typeof(callback) === 'function') {
              callback(err, data, self);
            }
          }
        );
      } else if (typeof(callback) === 'function') {
        callback(err, retdata, self);
      }
    }
  });
}

/**
*  refreshes the entity by making a GET call back to the database
*
*  @method fetch
*  @public
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Entity.prototype.fetch = function (callback) {
  var type = this.get('type');
  var self = this;

  //if a uuid is available, use that, otherwise, use the name
  if (this.get('uuid')) {
    type += '/' + this.get('uuid');
  } else {
    if (type === 'users') {
      if (this.get('username')) {
        type += '/' + this.get('username');
      } else {
        if (typeof(callback) === 'function') {
          var error = 'cannot fetch entity, no username specified';
          if (self._client.logging) {
            console.log(error);
          }
          return callback(true, error, self)
        }
      }
    } else {
      if (this.get('name')) {
        type += '/' + this.get('name');
      } else {
        if (typeof(callback) === 'function') {
          var error = 'cannot fetch entity, no name specified';
          if (self._client.logging) {
            console.log(error);
          }
          return callback(true, error, self)
        }
      }
    }
  }
  var options = {
    method:'GET',
    endpoint:type
  };
  this._client.request(options, function (err, data) {
    if (err && self._client.logging) {
      console.log('could not get entity');
    } else {
      if (data.user) {
        self.set(data.user);
      } else if (data.entities.length) {
        var entity = data.entities[0];
        self.set(entity);
      }
    }
    if (typeof(callback) === 'function') {
      callback(err, data, self);
    }
  });
}

/**
*  deletes the entity from the database - will only delete
*  if the object has a valid uuid
*
*  @method destroy
*  @public
*  @param {function} callback
*  @return {callback} callback(err, data)
*
*/
Entity.prototype.destroy = function (callback) {
  var type = this.get('type');
  if (isUUID(this.get('uuid'))) {
    type += '/' + this.get('uuid');
  } else {
    if (typeof(callback) === 'function') {
      var error = 'Error trying to delete object - no uuid specified.';
      if (self._client.logging) {
        console.log(error);
      }
      callback(true, error);
    }
  }
  var self = this;
  var options = {
    method:'DELETE',
    endpoint:type
  };
  this._client.request(options, function (err, data) {
    if (err && self._client.logging) {
      console.log('entity could not be deleted');
    } else {
      self.set(null);
    }
    if (typeof(callback) === 'function') {
      callback(err, data);
    }
  });
}



/**
*  The Collection class models Usergrid Collections.  It essentially
*  acts as a container for holding Entity objects, while providing
*  additional funcitonality such as paging, and saving
*
*  @constructor
*  @param {string} options - configuration object
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Collection = function(options, callback) {
  this._client = options.client;
  this._type = options.type;
  this._uuid = options.uuid;
  this.qs = options.qs || {};

  //iteration
  this._list = [];
  this._iterator = -1; //first thing we do is increment, so set to -1

  //paging
  this._previous = [];
  this._next = null;
  this._cursor = null


  var self = this;

  //get list of collections, see if this one exists
  var callOptions = {
    method:'GET',
    endpoint:''
  };
  this._client.request(callOptions, function (err, data) {
    if (err && self._client.logging) {
      console.log('error getting collections - check options passed to client');
      if (typeof(callback) === 'function') {
        return callback(err, data);
      }
    } else {
      //store collection list
      var collections = data.entities[0].metadata.collections;
      if ( collections.hasOwnProperty(self._type) ) {
        //collection exists, so just fetch
        self.fetch(function(err) {
          if (typeof(callback) === 'function') {
            return callback(err, data);
          }
        });
      } else {
        //collection doesn't exist, post first
        self._client.request(
          {
            method:'POST',
            endpoint:self._type,
            json:{},
            qs:self.qs
          },
          function (err, data) {
            if (err && self._client.logging) {
              console.log('error: collection not created');
            }
            if (typeof(callback) === 'function') {
              callback(err, data);
            }
          }
        );
      }
    }
  });
}

/**
*  Populates the collection from the server
*
*  @method fetch
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Collection.prototype.fetch = function (callback) {
  var self = this;
  var qs = this.qs;

  //add in the cursor if one is available
  if (this._cursor) {
    qs.cursor = this._cursor;
  } else {
    delete qs.cursor;
  }
  var options = {
    method:'GET',
    endpoint:this._type,
    qs:this.qs
  };
  this._client.request(options, function (err, data) {
    if(err && self._client.logging) {
     console.log('error getting collection');
    } else {
      //save the cursor if there is one
      var cursor = data.cursor || null;
      self.saveCursor(cursor);
      if (data.entities) {
        self.resetEntityPointer();
        var count = data.entities.length;
        //save entities locally
        for (var i=0;i<count;i++) {
          var uuid = data.entities[i].uuid;
          if (uuid) {
            var entityData = data.entities[i] || {};
            var entityOptions = {
              type:self._type,
              client:self._client,
              uuid:uuid,
              data:entityData
            };
            var ent = new Entity(entityOptions);
            var ct = self._list.length;
            self._list[ct] = ent;
          }
        }
      }
    }
    if (typeof(callback) === 'function') {
      callback(err, data);
    }
  });
}

/**
*  Adds a new Entity to the collection (saves, then adds to the local object)
*
*  @method addNewEntity
*  @param {object} entity
*  @param {function} callback
*  @return {callback} callback(err, data, entity)
*/
Collection.prototype.addEntity = function (options, callback) {
  var self = this;
  options.type = this._type;

  //create the new entity
  this._client.createEntity(options, function (err, entity) {
    if (!err) {
      //then add the entity to the list
      var count = self._list.length;
      self._list[count] = entity;
    }
    if (typeof(callback) === 'function') {
      callback(err, entity);
    }
  });
}

/**
*  Removes the Entity from the collection, then destroys the object on the server
*
*  @method destroyEntity
*  @param {object} entity
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Collection.prototype.destroyEntity = function (entity, callback) {
  var self = this;
  entity.destroy(function(err, data) {
    if (err) {
      if (self._client.logging) {
        console.log('could not destroy entity');
      }
      if (typeof(callback) === 'function') {
        callback(err, data);
      }
    } else {
      //destroy was good, so repopulate the collection
      self.fetch(callback);
    }
  });
}

/**
*  Looks up an Entity by UUID
*
*  @method getEntityByUUID
*  @param {string} UUID
*  @param {function} callback
*  @return {callback} callback(err, data, entity)
*/
Collection.prototype.getEntityByUUID = function (uuid, callback) {
  //get the entity from the database
  var options = {
    data: {
    	type: this._type,
    	uuid:uuid
    },
    client: this._client
  }
  var entity = new Entity(options);
  entity.fetch(callback);
}

/**
*  Returns the first Entity of the Entity list - does not affect the iterator
*
*  @method getFirstEntity
*  @return {object} returns an entity object
*/
Collection.prototype.getFirstEntity = function () {
  var count = this._list.length;
  if (count > 0) {
    return this._list[0];
  }
  return null;
}

/**
*  Returns the last Entity of the Entity list - does not affect the iterator
*
*  @method getLastEntity
*  @return {object} returns an entity object
*/
Collection.prototype.getLastEntity = function () {
  var count = this._list.length;
  if (count > 0) {
    return this._list[count-1];
  }
  return null;
}

/**
*  Entity iteration -Checks to see if there is a "next" entity
*  in the list.  The first time this method is called on an entity
*  list, or after the resetEntityPointer method is called, it will
*  return true referencing the first entity in the list
*
*  @method hasNextEntity
*  @return {boolean} true if there is a next entity, false if not
*/
Collection.prototype.hasNextEntity = function () {
  var next = this._iterator + 1;
  var hasNextElement = (next >=0 && next < this._list.length);
  if(hasNextElement) {
    return true;
  }
  return false;
}

/**
*  Entity iteration - Gets the "next" entity in the list.  The first
*  time this method is called on an entity list, or after the method
*  resetEntityPointer is called, it will return the,
*  first entity in the list
*
*  @method hasNextEntity
*  @return {object} entity
*/
Collection.prototype.getNextEntity = function () {
  this._iterator++;
  var hasNextElement = (this._iterator >= 0 && this._iterator <= this._list.length);
  if(hasNextElement) {
    return this._list[this._iterator];
  }
  return false;
}

/**
*  Entity iteration - Checks to see if there is a "previous"
*  entity in the list.
*
*  @method hasPrevEntity
*  @return {boolean} true if there is a previous entity, false if not
*/
Collection.prototype.hasPrevEntity = function () {
  var previous = this._iterator - 1;
  var hasPreviousElement = (previous >=0 && previous < this._list.length);
  if(hasPreviousElement) {
    return true;
  }
  return false;
}

/**
*  Entity iteration - Gets the "previous" entity in the list.
*
*  @method getPrevEntity
*  @return {object} entity
*/
Collection.prototype.getPrevEntity = function () {
   this._iterator--;
   var hasPreviousElement = (this._iterator >= 0 && this._iterator <= this._list.length);
   if(hasPreviousElement) {
    return this.list[this._iterator];
   }
   return false;
}

/**
*  Entity iteration - Resets the iterator back to the beginning
*  of the list
*
*  @method resetEntityPointer
*  @return none
*/
Collection.prototype.resetEntityPointer = function () {
   this._iterator  = -1;
}

/**
* Method to save off the cursor just returned by the last API call
*
* @public
* @method saveCursor
* @return none
*/
Collection.prototype.saveCursor = function(cursor) {
  //if current cursor is different, grab it for next cursor
  if (this._next !== cursor) {
    this._next = cursor;
  }
}

/**
* Resets the paging pointer (back to original page)
*
* @public
* @method resetPaging
* @return none
*/
Collection.prototype.resetPaging = function() {
  this._previous = [];
  this._next = null;
  this._cursor = null;
}

/**
*  Paging -  checks to see if there is a next page od data
*
*  @method hasNextPage
*  @return {boolean} returns true if there is a next page of data, false otherwise
*/
Collection.prototype.hasNextPage = function () {
  return (this._next);
}

/**
*  Paging - advances the cursor and gets the next
*  page of data from the API.  Stores returned entities
*  in the Entity list.
*
*  @method getNextPage
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Collection.prototype.getNextPage = function (callback) {
  if (this.hasNextPage()) {
    //set the cursor to the next page of data
    this._previous.push(this._cursor);
    this._cursor = this._next;
    //empty the list
    this._list = [];
    this.fetch(callback);
  }
}

/**
*  Paging -  checks to see if there is a previous page od data
*
*  @method hasPreviousPage
*  @return {boolean} returns true if there is a previous page of data, false otherwise
*/
Collection.prototype.hasPreviousPage = function () {
  return (this._previous.length > 0);
}

/**
*  Paging - reverts the cursor and gets the previous
*  page of data from the API.  Stores returned entities
*  in the Entity list.
*
*  @method getPreviousPage
*  @param {function} callback
*  @return {callback} callback(err, data)
*/
Collection.prototype.getPreviousPage = function (callback) {
  if (this.hasPreviousPage()) {
    this._next=null; //clear out next so the comparison will find the next item
    this._cursor = this._previous.pop();
    //empty the list
    this._list = [];
    this.fetch(callback);
  }
}

/**
* Tests if the string is a uuid
*
* @public
* @method isUUID
* @param {string} uuid The string to test
* @returns {Boolean} true if string is uuid
*/
function isUUID (uuid) {
  var uuidValueRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuid) return false;
  return uuidValueRegex.test(uuid);
}


/**
*  method to encode the query string parameters
*
*  @method encodeParams
*  @public
*  @params {object} params - an object of name value pairs that will be urlencoded
*  @return {string} Returns the encoded string
*/
function encodeParams (params) {
  tail = [];
  var item = [];
  if (params instanceof Array) {
    for (i in params) {
      item = params[i];
      if ((item instanceof Array) && (item.length > 1)) {
        tail.push(item[0] + "=" + encodeURIComponent(item[1]));
      }
    }
  } else {
    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        var value = params[key];
        if (value instanceof Array) {
          for (i in value) {
            item = value[i];
            tail.push(key + "=" + encodeURIComponent(item));
          }
        } else {
          tail.push(key + "=" + encodeURIComponent(value));
        }
      }
    }
  }
  return tail.join("&");
}
