export namespace main {
	
	export class AlarmBannerCfg {
	    enabled: boolean;
	    maxItems: number;
	
	    static createFrom(source: any = {}) {
	        return new AlarmBannerCfg(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.maxItems = source["maxItems"];
	    }
	}
	export class AuditEntry {
	    ts: number;
	    user: string;
	    level: string;
	    machine: string;
	    label: string;
	    address: string;
	    old: string;
	    new: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AuditEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ts = source["ts"];
	        this.user = source["user"];
	        this.level = source["level"];
	        this.machine = source["machine"];
	        this.label = source["label"];
	        this.address = source["address"];
	        this.old = source["old"];
	        this.new = source["new"];
	        this.error = source["error"];
	    }
	}
	export class WriteAction {
	    tag: string;
	    value: any;
	    release?: any;
	
	    static createFrom(source: any = {}) {
	        return new WriteAction(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tag = source["tag"];
	        this.value = source["value"];
	        this.release = source["release"];
	    }
	}
	export class ControlDef {
	    kind: string;
	    tag?: string;
	    label?: string;
	    tone?: string;
	    variant?: string;
	    momentary?: boolean;
	    write?: WriteAction;
	    minLevel?: string;
	
	    static createFrom(source: any = {}) {
	        return new ControlDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.tag = source["tag"];
	        this.label = source["label"];
	        this.tone = source["tone"];
	        this.variant = source["variant"];
	        this.momentary = source["momentary"];
	        this.write = this.convertValues(source["write"], WriteAction);
	        this.minLevel = source["minLevel"];
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
	export class SectionDef {
	    title?: string;
	    columns?: number;
	    items: ControlDef[];
	
	    static createFrom(source: any = {}) {
	        return new SectionDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.columns = source["columns"];
	        this.items = this.convertValues(source["items"], ControlDef);
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
	export class BlockDef {
	    type: string;
	    sections?: SectionDef[];
	    tags?: string[];
	    points?: number;
	
	    static createFrom(source: any = {}) {
	        return new BlockDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.sections = this.convertValues(source["sections"], SectionDef);
	        this.tags = source["tags"];
	        this.points = source["points"];
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
	
	export class TabDef {
	    id: string;
	    title: string;
	    blocks: BlockDef[];
	
	    static createFrom(source: any = {}) {
	        return new TabDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.blocks = this.convertValues(source["blocks"], BlockDef);
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
	export class MachineHMI {
	    tabs: TabDef[];
	
	    static createFrom(source: any = {}) {
	        return new MachineHMI(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tabs = this.convertValues(source["tabs"], TabDef);
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
	    ack?: string;
	
	    static createFrom(source: any = {}) {
	        return new StatusTags(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.run = source["run"];
	        this.alarm = source["alarm"];
	        this.ack = source["ack"];
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
	    hmi?: MachineHMI;
	
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
	        this.hmi = this.convertValues(source["hmi"], MachineHMI);
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
	export class SecuritySettings {
	    requireLogin: boolean;
	    sessionTimeoutMin: number;
	
	    static createFrom(source: any = {}) {
	        return new SecuritySettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.requireLogin = source["requireLogin"];
	        this.sessionTimeoutMin = source["sessionTimeoutMin"];
	    }
	}
	export class UISettings {
	    alarmBanner: AlarmBannerCfg;
	
	    static createFrom(source: any = {}) {
	        return new UISettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.alarmBanner = this.convertValues(source["alarmBanner"], AlarmBannerCfg);
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
	    ui: UISettings;
	    security: SecuritySettings;
	    machines: Machine[];
	
	    static createFrom(source: any = {}) {
	        return new HMIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.plc = this.convertValues(source["plc"], PlcInfo);
	        this.ui = this.convertValues(source["ui"], UISettings);
	        this.security = this.convertValues(source["security"], SecuritySettings);
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
	
	
	
	export class Recipe {
	    name: string;
	    values: Record<string, any>;
	    updated?: number;
	
	    static createFrom(source: any = {}) {
	        return new Recipe(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.values = source["values"];
	        this.updated = source["updated"];
	    }
	}
	export class RuntimeFlags {
	    onlyMouse: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RuntimeFlags(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.onlyMouse = source["onlyMouse"];
	    }
	}
	
	
	export class SessionInfo {
	    authenticated: boolean;
	    username?: string;
	    level?: string;
	    since?: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.authenticated = source["authenticated"];
	        this.username = source["username"];
	        this.level = source["level"];
	        this.since = source["since"];
	    }
	}
	
	export class Snapshot {
	    connected: boolean;
	    error?: string;
	    ts: number;
	    values: Record<string, any>;
	    eip?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connected = source["connected"];
	        this.error = source["error"];
	        this.ts = source["ts"];
	        this.values = source["values"];
	        this.eip = source["eip"];
	    }
	}
	
	
	
	
	export class UserSummary {
	    username: string;
	    level: string;
	
	    static createFrom(source: any = {}) {
	        return new UserSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.username = source["username"];
	        this.level = source["level"];
	    }
	}
	export class ValidateResult {
	    errors: string[];
	    warnings: string[];
	    saved: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ValidateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.errors = source["errors"];
	        this.warnings = source["warnings"];
	        this.saved = source["saved"];
	    }
	}

}

