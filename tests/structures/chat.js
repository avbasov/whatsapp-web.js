const { expect } = require('chai');

const helper = require('../helper');
const Message = require('../../src/structures/Message');
const { MessageTypes } = require('../../src/util/Constants');
const { Contact } = require('../../src/structures');

const remoteId = helper.remoteId;

describe('Chat', function () {
    let client;
    let chat;

    before(async function () {
        this.timeout(35000);
        client = helper.createClient({ authenticated: true });
        await client.initialize();
        chat = await client.getChatById(remoteId);
    });

    after(async function () {
        await client.destroy();
    });

    it('can send a message to a chat', async function () {
        const msg = await chat.sendMessage('hello world');
        expect(msg).to.be.instanceOf(Message);
        expect(msg.type).to.equal(MessageTypes.TEXT);
        expect(msg.fromMe).to.equal(true);
        expect(msg.body).to.equal('hello world');
        expect(msg.to).to.equal(remoteId);
    });

    it('can fetch messages sent in a chat', async function () {
        await helper.sleep(1000);
        const msg = await chat.sendMessage('another message');
        await helper.sleep(500);

        const messages = await chat.fetchMessages();
        expect(messages.length).to.be.greaterThanOrEqual(2);

        const fetchedMsg = messages[messages.length - 1];
        expect(fetchedMsg).to.be.instanceOf(Message);
        expect(fetchedMsg.type).to.equal(MessageTypes.TEXT);
        expect(fetchedMsg.id._serialized).to.equal(msg.id._serialized);
        expect(fetchedMsg.body).to.equal(msg.body);
    });

    it('can use a limit when fetching messages sent in a chat', async function () {
        await helper.sleep(1000);
        const msg = await chat.sendMessage('yet another message');
        await helper.sleep(500);

        const messages = await chat.fetchMessages({ limit: 1 });
        expect(messages).to.have.lengthOf(1);

        const fetchedMsg = messages[0];
        expect(fetchedMsg).to.be.instanceOf(Message);
        expect(fetchedMsg.type).to.equal(MessageTypes.TEXT);
        expect(fetchedMsg.id._serialized).to.equal(msg.id._serialized);
        expect(fetchedMsg.body).to.equal(msg.body);
    });

    it('can use fromMe=true when fetching messages sent in a chat to get only bot messages', async function () {
        const messages = await chat.fetchMessages({ fromMe: true });
        expect(messages).to.have.lengthOf(2);
    });

    it('can use fromMe=false when fetching messages sent in a chat to get only non bot messages', async function () {
        const messages = await chat.fetchMessages({ fromMe: false });
        expect(messages).to.have.lengthOf(0);
    });

    describe('fetchMessages by id', function () {
        let target;

        before(async function () {
            this.timeout(10000);
            await helper.sleep(1000);
            target = await chat.sendMessage('fetch me by id');
            await helper.sleep(500);
        });

        it('resolves a message by its serialized id', async function () {
            const messages = await chat.fetchMessages({
                messageId: target.id._serialized,
                limit: 1,
            });
            expect(messages).to.have.lengthOf(1);
            expect(messages[0]).to.be.instanceOf(Message);
            expect(messages[0].id._serialized).to.equal(target.id._serialized);
            expect(messages[0].body).to.equal('fetch me by id');
        });

        it('resolves a message by its bare fingerprint', async function () {
            const messages = await chat.fetchMessages({
                messageId: target.id.id,
                limit: 1,
            });
            expect(messages).to.have.lengthOf(1);
            expect(messages[0].id._serialized).to.equal(target.id._serialized);
        });

        it('resolves a message that is outside the loaded window', async function () {
            this.timeout(20000);

            // Push the target out of the default message window, so the id has
            // to be resolved through the message DB rather than found in the
            // already-loaded models.
            for (let i = 0; i < 3; i++) {
                await chat.sendMessage(`filler ${i}`);
                await helper.sleep(300);
            }

            // A fresh chat model starts with an unpolluted message window.
            const refreshed = await client.getChatById(remoteId);
            const messages = await refreshed.fetchMessages({
                messageId: target.id.id,
                limit: 1,
            });
            expect(messages).to.have.lengthOf(1);
            expect(messages[0].id._serialized).to.equal(target.id._serialized);
        });

        it('ignores limit when a messageId is given', async function () {
            const messages = await chat.fetchMessages({
                messageId: target.id._serialized,
                limit: 50,
            });
            expect(messages).to.have.lengthOf(1);
        });

        it('returns an empty array for an unknown id', async function () {
            const messages = await chat.fetchMessages({
                messageId: 'ABCDEF0123456789NOPE',
                limit: 1,
            });
            expect(messages).to.have.lengthOf(0);
        });

        it("returns an empty array for another chat's message", async function () {
            let otherChat;
            try {
                otherChat = await client.getChatById(
                    client.info.wid._serialized,
                );
            } catch {
                this.skip();
            }
            if (!otherChat || otherChat.id._serialized === remoteId) {
                this.skip();
            }

            const messages = await otherChat.fetchMessages({
                messageId: target.id._serialized,
                limit: 1,
            });
            expect(messages).to.have.lengthOf(0);
        });
    });

    describe('fetchMessages since', function () {
        it('returns messages at or after the given timestamp', async function () {
            const since = Math.floor(Date.now() / 1000) - 5;
            await helper.sleep(1000);
            const msg = await chat.sendMessage('recent enough');
            await helper.sleep(500);

            const messages = await chat.fetchMessages({ since });
            expect(messages.length).to.be.greaterThanOrEqual(1);
            expect(
                messages.some((m) => m.id._serialized === msg.id._serialized),
            ).to.equal(true);
            expect(messages.every((m) => m.timestamp >= since)).to.equal(true);
        });

        it('returns an empty array for a future timestamp', async function () {
            const messages = await chat.fetchMessages({
                since: Math.floor(Date.now() / 1000) + 3600,
            });
            expect(messages).to.have.lengthOf(0);
        });
    });

    it('can get the related contact', async function () {
        const contact = await chat.getContact();
        expect(contact).to.be.instanceOf(Contact);
        expect(contact.id._serialized).to.equal(chat.id._serialized);
    });

    describe('Seen', function () {
        it('can mark a chat as unread', async function () {
            await chat.markUnread();
            await helper.sleep(500);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.unreadCount).to.equal(-1);
        });

        it('can mark a chat as seen', async function () {
            const res = await chat.sendSeen();
            expect(res).to.equal(true);

            await helper.sleep(1000);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.unreadCount).to.equal(0);
        });
    });

    describe('Archiving', function () {
        it('can archive a chat', async function () {
            const res = await chat.archive();
            expect(res).to.equal(true);

            await helper.sleep(1000);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.archived).to.equal(true);
        });

        it('can unarchive a chat', async function () {
            const res = await chat.unarchive();
            expect(res).to.equal(false);

            await helper.sleep(1000);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.archived).to.equal(false);
        });
    });

    describe('Pinning', function () {
        it('can pin a chat', async function () {
            const res = await chat.pin();
            expect(res).to.equal(true);

            await helper.sleep(1000);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.pinned).to.equal(true);
        });

        it('can unpin a chat', async function () {
            const res = await chat.unpin();
            expect(res).to.equal(false);
            await helper.sleep(1000);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.pinned).to.equal(false);
        });
    });

    describe('Muting', function () {
        it('can mute a chat forever', async function () {
            await chat.mute();

            await helper.sleep(1000);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.isMuted).to.equal(true);
            expect(chat.muteExpiration).to.equal(-1);
        });

        it('can mute a chat until a specific date', async function () {
            const unmuteDate = new Date(new Date().getTime() + 1000 * 60 * 60);
            await chat.mute(unmuteDate);

            await helper.sleep(1000);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.isMuted).to.equal(true);
            expect(chat.muteExpiration).to.equal(
                Math.round(unmuteDate.getTime() / 1000),
            );
        });

        it('can unmute a chat', async function () {
            await chat.unmute();
            await helper.sleep(500);

            // refresh chat
            chat = await client.getChatById(remoteId);
            expect(chat.isMuted).to.equal(false);
            expect(chat.muteExpiration).to.equal(0);
        });
    });

    // eslint-disable-next-line mocha/no-pending-tests
    describe.skip('Destructive operations', function () {
        it('can clear all messages from chat', async function () {
            const res = await chat.clearMessages();
            expect(res).to.equal(true);

            await helper.sleep(3000);

            const msgs = await chat.fetchMessages();
            expect(msgs).to.have.lengthOf(0);
        });

        it('can delete a chat', async function () {
            const res = await chat.delete();
            expect(res).to.equal(true);
        });
    });
});
