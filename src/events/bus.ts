import { EventEmitter } from 'events';

export interface HubEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

class EventBus extends EventEmitter {
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  publish(type: string, data: unknown): void {
    const hubEvent: HubEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.emit(type, hubEvent);
    this.emit('*', hubEvent); // wildcard for subscribers that want everything
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
