const { expect } = require('chai');
const sinon = require('sinon');
const vm = require('vm');

const { LoadUtils } = require('../src/util/Injected/Utils');

const SINGLE_SELECT = 1;
const DISPLAY_TEXT = 1;

function quickReply(id, text, extra = {}) {
    return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: text, id, ...extra }),
    };
}

function loadPage(msg) {
    const chat = { id: { _serialized: 'bot@c.us' } };
    const sentId = { _serialized: 'true_bot@c.us_SENT' };
    const sent = { id: sentId };
    const modules = {
        WAWebCollections: {
            Msg: {
                get: (id) =>
                    ({ [msg.id._serialized]: msg, [sentId._serialized]: sent })[
                        id
                    ],
                getMessagesById: async () => ({ messages: [] }),
            },
        },
        WAWebFrontendMsgGetters: { getChat: () => chat },
        WAWebMsgDataUtils: {
            genOutgoingMsgData: async (_chat, type) => ({
                id: sentId,
                type,
            }),
        },
        'WAWebProtobufsE2E.pb': {
            Message$ListResponseMessage$ListType: { SINGLE_SELECT },
            Message$ButtonsResponseMessage$Type: { DISPLAY_TEXT },
        },
        WAWebUserPrefsMeUser: {
            getMePnUserOrThrow_DO_NOT_USE: () => 'me@c.us',
        },
        WAWebMsgKey: Object.assign(
            function MsgKey(fields) {
                Object.assign(this, fields, sentId);
            },
            { newId: async () => 'SENT' },
        ),
        WAWebAck: { ACK: { CLOCK: 0 } },
        WATimeUtils: { unixTime: () => 1700000000 },
        WAWebHsmGatingUtils: { shouldUseLegacyButtonsResponse: () => true },
        WAWebSendTextMsgChatAction: {
            createTextMsgData: sinon.fake(async (_chat, body, options) => ({
                id: sentId,
                type: 'template_button_reply',
                body,
                ...options,
            })),
        },
        WAWebSendMsgChatAction: {
            addAndSendMsgToChat: sinon.fake(() => [
                Promise.resolve(),
                Promise.resolve(),
            ]),
        },
        WAWebBizInteractiveMessageQuickReplyAction: {
            markInteractiveButtonClicked: sinon.fake.resolves(),
        },
    };
    const window = { require: (name) => modules[name] };
    vm.runInContext(
        `(${LoadUtils.toString()})()`,
        vm.createContext({ window }),
    );
    return { window, modules, chat, sent };
}

describe('WWebJS.selectMessageOption', function () {
    const listMsg = {
        id: { _serialized: 'false_bot@c.us_LIST' },
        type: 'list',
        list: {
            sections: [
                {
                    rows: [
                        { rowId: 'r1', title: 'Dubai' },
                        { rowId: 'r2', title: 'Paris', description: 'FR' },
                    ],
                },
            ],
        },
        msgContextInfo: () => ({ quotedMsg: 'LIST' }),
    };

    it('sends a list response for the chosen row', async function () {
        const { window, modules, chat, sent } = loadPage(listMsg);

        const result = await window.WWebJS.selectMessageOption(
            listMsg.id._serialized,
            'r2',
        );

        expect(result).to.equal(sent);
        const [target, data] =
            modules.WAWebSendMsgChatAction.addAndSendMsgToChat.firstCall.args;
        expect(target).to.equal(chat);
        expect(data).to.deep.include({
            type: 'list_response',
            kind: 'listResponse',
            quotedMsg: 'LIST',
            body: 'Paris\nFR',
            listResponse: {
                listType: SINGLE_SELECT,
                title: 'Paris',
                description: 'FR',
                singleSelectReply: { selectedRowId: 'r2' },
            },
        });
    });

    it('rejects a row the list does not have', async function () {
        const { window, modules } = loadPage(listMsg);

        let error;
        try {
            await window.WWebJS.selectMessageOption(
                listMsg.id._serialized,
                'nope',
            );
        } catch (e) {
            error = e;
        }

        expect(error?.message).to.equal('List row not found');
        expect(modules.WAWebSendMsgChatAction.addAndSendMsgToChat.called).to.be
            .false;
    });

    it('sends a quick reply with the button index and marks it used', async function () {
        const msg = {
            id: { _serialized: 'false_bot@c.us_BTN' },
            type: 'interactive',
            interactivePayload: {
                buttons: [
                    {
                        name: 'cta_url',
                        buttonParamsJson: '{"display_text":"Site"}',
                    },
                    quickReply('YES', 'Yes'),
                    quickReply('NO', 'No'),
                ],
            },
        };
        const { window, modules, chat, sent } = loadPage(msg);

        const result = await window.WWebJS.selectMessageOption(
            msg.id._serialized,
            'NO',
        );

        expect(result).to.equal(sent);
        expect(
            modules.WAWebSendTextMsgChatAction.createTextMsgData.firstCall.args,
        ).to.deep.equal([
            chat,
            'No',
            { quotedMsg: msg, selectedIndex: 2, selectedId: 'NO' },
        ]);
        expect(
            modules.WAWebSendMsgChatAction.addAndSendMsgToChat.firstCall.args[1]
                .type,
        ).to.equal('template_button_reply');
        expect(
            modules.WAWebBizInteractiveMessageQuickReplyAction
                .markInteractiveButtonClicked.firstCall.args,
        ).to.deep.equal([msg, 2]);
    });

    it('refuses a quick reply WhatsApp already disabled', async function () {
        const msg = {
            id: { _serialized: 'false_bot@c.us_BTN' },
            type: 'interactive',
            interactivePayload: {
                buttons: [quickReply('YES', 'Yes', { disabled: true })],
            },
        };
        const { window, modules } = loadPage(msg);

        let error;
        try {
            await window.WWebJS.selectMessageOption(msg.id._serialized, 'YES');
        } catch (e) {
            error = e;
        }

        expect(error?.message).to.equal('Quick reply was already used');
        expect(modules.WAWebSendMsgChatAction.addAndSendMsgToChat.called).to.be
            .false;
    });

    describe('legacy reply buttons', function () {
        function buttonsMsg(selected = false) {
            return {
                id: { _serialized: 'false_bot@c.us_BTNS' },
                type: 'chat',
                isDynamicReplyButtonsMsg: true,
                dynamicReplyButtons: [
                    {
                        type: 1,
                        buttonId: '{"reply":"Main menu 1"}',
                        buttonText: { displayText: 'Main menu' },
                    },
                    {
                        type: 1,
                        buttonId: '{"reply":"End Chat 3"}',
                        buttonText: { displayText: 'End Chat' },
                    },
                ],
                replyButtons: {
                    models: {
                        '{"reply":"End Chat 3"}': { selected },
                    },
                    get(id) {
                        return this.models[id];
                    },
                },
                msgContextInfo: () => ({ quotedStanzaID: 'BTNS' }),
            };
        }

        it('sends a buttons response and marks the button selected', async function () {
            const msg = buttonsMsg();
            const { window, modules, chat, sent } = loadPage(msg);

            const result = await window.WWebJS.selectMessageOption(
                msg.id._serialized,
                '{"reply":"End Chat 3"}',
            );

            expect(result).to.equal(sent);
            const [target, data] =
                modules.WAWebSendMsgChatAction.addAndSendMsgToChat.firstCall
                    .args;
            expect(target).to.equal(chat);
            expect(data).to.deep.include({
                type: 'buttons_response',
                kind: 'buttonsResponse',
                from: 'me@c.us',
                to: chat.id,
                quotedStanzaID: 'BTNS',
                selectedButtonId: '{"reply":"End Chat 3"}',
                buttonsResponse: {
                    selectedButtonId: '{"reply":"End Chat 3"}',
                    selectedDisplayText: 'End Chat',
                    type: DISPLAY_TEXT,
                },
                body: 'End Chat',
            });
            expect(data.id).to.deep.include({ id: 'SENT', selfDir: 'out' });
            expect(
                msg.replyButtons.get('{"reply":"End Chat 3"}').selected,
            ).to.equal(true);
        });

        it('refuses a button WhatsApp already marked selected', async function () {
            const msg = buttonsMsg(true);
            const { window, modules } = loadPage(msg);

            let error;
            try {
                await window.WWebJS.selectMessageOption(
                    msg.id._serialized,
                    '{"reply":"End Chat 3"}',
                );
            } catch (e) {
                error = e;
            }

            expect(error?.message).to.equal('Reply button was already used');
            expect(modules.WAWebSendMsgChatAction.addAndSendMsgToChat.called).to
                .be.false;
        });
    });
});
