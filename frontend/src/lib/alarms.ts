export interface AlarmEvent {
        id: number;
        machineId: string;
        machineName: string;
        label: string;
        address: string;
        ts: number;
        clearedTs: number | null;
        ackedTs: number | null;
}
