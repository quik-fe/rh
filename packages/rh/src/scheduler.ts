export enum Priority {
  HIGH = "user-blocking",
  NORMAL = "user-visible",
  LOW = "background",
}

export interface IScheduler {
  nextTick(
    fn: () => void,
    priority: Priority,
    delay?: number
  ): void | Promise<void>;
  shouldYield(): boolean;
}

type SchedulerTask = {
  fn: () => void;
  priority: Priority;
};

export class ChromeScheduler implements IScheduler {
  scheduler = globalThis.scheduler;
  getCurrentTime = globalThis.performance.now.bind(
    globalThis.performance
  ) as () => number;

  queues = {
    [Priority.HIGH]: {
      running: false,
      queue: [] as SchedulerTask[],
    },
    [Priority.NORMAL]: {
      running: false,
      queue: [] as SchedulerTask[],
    },
    [Priority.LOW]: {
      running: false,
      queue: [] as SchedulerTask[],
    },
  };

  deadline = 0;
  frameTime = 1000 / 30;

  postPerformTask(priority: Priority) {
    this.scheduler.postTask(
      this.performWorkUntilDeadline.bind(this, priority),
      {
        priority: priority,
      }
    );
  }
  performWorkUntilDeadline(priority: Priority) {
    const taskQueues = this.queues;
    this.deadline = this.getCurrentTime() + this.frameTime;
    const taskQueue = taskQueues[priority].queue;

    while (taskQueue.length > 0) {
      if (this.shouldYield()) {
        this.postPerformTask(priority);
        return;
      }

      try {
        const task = taskQueue.shift();
        task?.fn();
      } catch (error) {
        setTimeout(() => {
          throw error;
        });
      }
    }

    taskQueues[priority].running = false;
  }

  enqueue(task: SchedulerTask) {
    const taskQueues = this.queues;
    const { priority } = task;
    taskQueues[priority].queue.push(task);
    if (taskQueues[priority].running) return;
    taskQueues[priority].running = true;
    this.postPerformTask(priority);
  }

  async nextTick(fn: () => void, priority: Priority, delay?: number) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.enqueue({ fn, priority });
  }

  shouldYield(): boolean {
    return this.getCurrentTime() >= this.deadline;
  }
}

export class TimeSliceScheduler implements IScheduler {
  getCurrentTime = globalThis.performance.now.bind(
    globalThis.performance
  ) as () => number;

  queues = {
    [Priority.HIGH]: {
      queue: [] as SchedulerTask[],
    },
    [Priority.NORMAL]: {
      queue: [] as SchedulerTask[],
    },
    [Priority.LOW]: {
      queue: [] as SchedulerTask[],
    },
  };

  channel = new MessageChannel();
  running = false;
  port = this.channel.port1;
  fps = 30;
  frameTime = 1000 / this.fps;

  deadline = 0;
  previousFrameTime = 0;

  constructor() {
    this.channel.port1.onmessage = () => {
      const { frameTime, previousFrameTime } = this;
      const currentTime = performance.now();
      const didTimeout =
        previousFrameTime !== 0 && currentTime - previousFrameTime >= frameTime;

      if (didTimeout) {
        this.deadline = currentTime + frameTime;
      } else {
        const nextFrameTime =
          Math.round(currentTime / frameTime) * frameTime + frameTime;
        this.deadline = nextFrameTime;
        requestAnimationFrame(() => {
          this.executeHighPriorityTasks();
          this.previousFrameTime = performance.now();
        });
      }

      this.performWorkUntilDeadline();
    };
  }

  private getNextTask() {
    const taskQueues = this.queues;
    if (taskQueues[Priority.HIGH].queue.length > 0)
      return taskQueues[Priority.HIGH].queue.shift()!;
    if (taskQueues[Priority.NORMAL].queue.length > 0)
      return taskQueues[Priority.NORMAL].queue.shift()!;
    if (taskQueues[Priority.LOW].queue.length > 0)
      return taskQueues[Priority.LOW].queue.shift()!;
    return null;
  }

  private scheduleCallback(callback: () => any, priority: Priority) {
    const { queue } = this.queues[priority];
    queue.push({ fn: callback, priority });
    if (!this.running) {
      this.port.postMessage(null);
      this.running = true;
    }
  }

  private executeHighPriorityTasks() {
    const { queue } = this.queues[Priority.HIGH];
    while (queue.length > 0) {
      const task = queue.shift();
      task && this.executeTask(task);
    }
  }

  private performWorkUntilDeadline() {
    let task = this.getNextTask();
    while (task) {
      if (this.shouldYield()) {
        this.port.postMessage(null);
        return;
      }
      this.executeTask(task);
    }
    this.running = false;
  }

  private executeTask(task: SchedulerTask) {
    try {
      task.fn();
    } catch (error) {
      setTimeout(() => {
        throw error;
      });
    }
  }

  async nextTick(
    fn: () => void,
    priority: Priority,
    delay?: number
  ): Promise<void> {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.scheduleCallback(fn, priority);
  }
  shouldYield(): boolean {
    return this.getCurrentTime() >= this.deadline;
  }
}

export class SyncScheduler implements IScheduler {
  nextTick(
    fn: () => void,
    priority: Priority,
    delay: number
  ): void | Promise<void> {
    if (delay) setTimeout(fn, delay);
    else fn();
  }
  shouldYield(): boolean {
    return false;
  }
}

export class MixScheduler implements IScheduler {
  private _scheduler: IScheduler;

  constructor() {
    if (globalThis.__force_sync_scheduler__) {
      this._scheduler = new SyncScheduler();
    } else if (typeof globalThis?.scheduler?.postTask === "function") {
      this._scheduler = new ChromeScheduler();
    } else {
      this._scheduler = new TimeSliceScheduler();
    }
  }

  nextTick(
    fn: () => void,
    priority: Priority = Priority.NORMAL,
    delay?: number
  ): void | Promise<void> {
    return this._scheduler.nextTick(fn, priority, delay);
  }
  shouldYield(): boolean {
    return this._scheduler.shouldYield();
  }
}
