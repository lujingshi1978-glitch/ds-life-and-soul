import {TransportInbox} from './transport-inbox.js';

// Compatibility for offline callers; the bridge injects one shared TransportInbox.
export class EnergyInbox extends TransportInbox {
  constructor(file,options){super(file,options);try{this.migrateLegacy({energyInboxFile:file});}catch(error){this.close();throw error;}}
  buffer(kind,peer,event,account,reason='energy-rest'){return super.buffer(kind,peer,event,account,reason);}
}
