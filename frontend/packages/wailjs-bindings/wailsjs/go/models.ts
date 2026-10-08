export namespace main {
	
	export class TagDef {
	    name: string;
	    label: string;
	    address: string;
	    dataType: string;
	    access: string;
	    unit?: string;
	    min?: number;
	    max?: number;
	    group?: string;
	    default?: any;
	
	    static createFrom(source: any = {}) {
	        return new TagDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.label = source["label"];
	        this.address = source["address"];
	        this.dataType = source["dataType"];
	        this.access = source["access"];
	        this.unit = source["unit"];
	        this.min = source["min"];
	        this.max = source["max"];
	        this.group = source["group"];
	        this.default = source["default"];
	    }
	}
	export class StatusTags {
	    run?: string;
	    alarm?: string;
	
	    static createFrom(source: any = {}) {
	        return new StatusTags(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.run = source["run"];
	        this.alarm = source["alarm"];
	    }
	}
	export class Size {
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new Size(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class Machine {
	    id: string;
	    name: string;
	    type: string;
	    image: string;
	    size: Size;
	    statusTags?: StatusTags;
	    tags: TagDef[];
	
	    static createFrom(source: any = {}) {
	        return new Machine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.image = source["image"];
	        this.size = this.convertValues(source["size"], Size);
	        this.statusTags = this.convertValues(source["statusTags"], StatusTags);
	        this.tags = this.convertValues(source["tags"], TagDef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlcInfo {
	    name: string;
	    endpoint: string;
	    pollIntervalMs: number;
	
	    static createFrom(source: any = {}) {
	        return new PlcInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.endpoint = source["endpoint"];
	        this.pollIntervalMs = source["pollIntervalMs"];
	    }
	}
	export class HMIConfig {
	    version: number;
	    plc: PlcInfo;
	    machines: Machine[];
	
	    static createFrom(source: any = {}) {
	        return new HMIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.plc = this.convertValues(source["plc"], PlcInfo);
	        this.machines = this.convertValues(source["machines"], Machine);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class Snapshot {
	    connected: boolean;
	    error?: string;
	    ts: number;
	    values: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connected = source["connected"];
	        this.error = source["error"];
	        this.ts = source["ts"];
	        this.values = source["values"];
	    }
	}
	

}

