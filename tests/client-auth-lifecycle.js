const { expect } = require('chai');
const EventEmitter = require('events');
const sinon = require('sinon');
const vm = require('vm');

const Client = require('../src/Client');

describe('Client authentication lifecycle', function () {
    it('waits for authentication before wiring after repeated injections', async function () {
        let resolvePayload;
        const payload = new Promise((resolve) => {
            resolvePayload = resolve;
        });
        const client = new Client();
        const getPayload = sinon
            .stub(client.authStrategy, 'getAuthEventPayload')
            .returns(payload);
        sinon.stub(client, 'setDeviceName').resolves();
        sinon.stub(client, 'getWWebVersion').resolves('test-version');

        const socket = new EventEmitter();
        socket.hasSynced = true;
        const modules = {
            WAWebSocketModel: { Socket: socket },
            WAWebCmd: { Cmd: new EventEmitter() },
        };
        const pageWindow = { require: (name) => modules[name] };
        const context = vm.createContext({ window: pageWindow });
        const syncCalls = [];
        client.pupPage = {
            waitForFunction: async () => ({
                jsonValue: async () => ({ need: false }),
            }),
            evaluate: async (fn, ...args) =>
                vm.runInContext(`(${fn.toString()})`, context)(...args),
            exposeFunction: async (name, fn) => {
                pageWindow[name] = (...args) => {
                    const result = fn(...args);
                    if (name === 'onAppStateHasSyncedEvent') {
                        syncCalls.push(result);
                    }
                    return result;
                };
            },
        };
        const wireStore = sinon
            .stub(client, '_wireStore')
            .callsFake(async () => {
                if (pageWindow.WWebJS?.wired) return;
                pageWindow.WWebJS = { wired: true };
                pageWindow.onConnectionStateEvent('CONNECTED');
            });
        const events = [];
        const readyHandler = sinon.spy();
        client.on('authenticated', (authPayload) => {
            events.push(['authenticated', authPayload]);
            client.on('ready', readyHandler);
        });
        client.on('ready', () => events.push(['ready']));

        try {
            await client.inject();
            await client.inject();
            await new Promise((resolve) => setImmediate(resolve));

            expect(syncCalls).to.have.length(2);
            expect(getPayload.callCount).to.equal(1);
            expect(wireStore.called).to.equal(false);
            expect(events).to.deep.equal([]);
        } finally {
            resolvePayload('auth-payload');
            await Promise.all(syncCalls);
        }

        expect(events).to.deep.equal([
            ['authenticated', 'auth-payload'],
            ['ready'],
        ]);
        expect(readyHandler.callCount).to.equal(1);
        expect(getPayload.callCount).to.equal(1);
    });
});
