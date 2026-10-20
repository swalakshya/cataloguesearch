import { emit, relative, errors } from './events.mjs';
export default class DashboardReporter {
    onInit(ctx) { this.ctx = ctx; }
    onTestModuleStart(module) { emit(relative(module.moduleId), 'start'); }
    onTestCaseResult(test) {
        const result = test.result();
        const status = { passed: 'passed', failed: 'failed', skipped: 'skipped', pending: 'skipped' }[result.state] || 'skipped';
        emit(relative(test.module.moduleId), 'test', { test: test.fullName, status, duration: (test.diagnostic()?.duration || 0) / 1000, text: errors(result.errors) });
    }
    onUserConsoleLog(log) {
        const entity = log.taskId && this.ctx.state.getReportedEntityById(log.taskId);
        const module = entity?.module || entity;
        emit(relative(module?.moduleId), 'log', { text: log.content });
    }
    onTestModuleEnd(module) {
        const file = relative(module.moduleId);
        if (module.errors().length) emit(file, 'error', { text: errors(module.errors()) });
        emit(file, 'finish');
    }
    onTestRunEnd(modules, unhandledErrors) {
        if (unhandledErrors.length) emit('__setup__', 'error', { text: errors(unhandledErrors) });
    }
}
