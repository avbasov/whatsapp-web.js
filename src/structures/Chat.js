'use strict';

const Base = require('./Base');
const Message = require('./Message');

/**
 * Represents a Chat on WhatsApp
 * @extends {Base}
 */
class Chat extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * ID that represents the chat
         * @type {object}
         */
        this.id = Base._normalizeId(data.id);

        /**
         * Title of the chat
         * @type {string}
         */
        this.name = data.formattedTitle;

        /**
         * Indicates if the Chat is a Group Chat
         * @type {boolean}
         */
        this.isGroup = data.isGroup;

        /**
         * Indicates if the Chat is readonly
         * @type {boolean}
         */
        this.isReadOnly = data.isReadOnly;

        /**
         * Amount of messages unread
         * @type {number}
         */
        this.unreadCount = data.unreadCount;

        /**
         * Unix timestamp for when the last activity occurred
         * @type {number}
         */
        this.timestamp = data.t;

        /**
         * Indicates if the Chat is archived
         * @type {boolean}
         */
        this.archived = data.archive;

        /**
         * Indicates if the Chat is pinned
         * @type {boolean}
         */
        this.pinned = !!data.pin;

        /**
         * Indicates if the Chat is locked
         * @type {boolean}
         */
        this.isLocked = data.isLocked;

        /**
         * Indicates if the chat is muted or not
         * @type {boolean}
         */
        this.isMuted = data.isMuted;

        /**
         * Unix timestamp for when the mute expires
         * @type {number}
         */
        this.muteExpiration = data.muteExpiration;

        /**
         * Last message fo chat
         * @type {Message}
         */
        this.lastMessage = data.lastMessage
            ? new Message(this.client, data.lastMessage)
            : undefined;

        return super._patch(data);
    }

    /**
     * Send a message to this chat
     * @param {string|MessageMedia|Location} content
     * @param {MessageSendOptions} [options]
     * @returns {Promise<Message>} Message that was just sent
     */
    async sendMessage(content, options) {
        return this.client.sendMessage(this.id._serialized, content, options);
    }

    /**
     * Sets the chat as seen
     * @returns {Promise<Boolean>} result
     */
    async sendSeen() {
        return this.client.sendSeen(this.id._serialized);
    }

    /**
     * Clears all messages from the chat
     * @returns {Promise<boolean>} result
     */
    async clearMessages() {
        return this.client.pupPage.evaluate((chatId) => {
            return window.WWebJS.sendClearChat(chatId);
        }, this.id._serialized);
    }

    /**
     * Deletes the chat
     * @returns {Promise<Boolean>} result
     */
    async delete() {
        return this.client.pupPage.evaluate((chatId) => {
            return window.WWebJS.sendDeleteChat(chatId);
        }, this.id._serialized);
    }

    /**
     * Archives this chat
     */
    async archive() {
        return this.client.archiveChat(this.id._serialized);
    }

    /**
     * un-archives this chat
     */
    async unarchive() {
        return this.client.unarchiveChat(this.id._serialized);
    }

    /**
     * Pins this chat
     * @returns {Promise<boolean>} New pin state. Could be false if the max number of pinned chats was reached.
     */
    async pin() {
        return this.client.pinChat(this.id._serialized);
    }

    /**
     * Unpins this chat
     * @returns {Promise<boolean>} New pin state
     */
    async unpin() {
        return this.client.unpinChat(this.id._serialized);
    }

    /**
     * Mutes this chat forever, unless a date is specified
     * @param {?Date} unmuteDate Date when the chat will be unmuted, don't provide a value to mute forever
     * @returns {Promise<{isMuted: boolean, muteExpiration: number}>}
     */
    async mute(unmuteDate) {
        const result = await this.client.muteChat(
            this.id._serialized,
            unmuteDate,
        );
        this.isMuted = result.isMuted;
        this.muteExpiration = result.muteExpiration;
        return result;
    }

    /**
     * Unmutes this chat
     * @returns {Promise<{isMuted: boolean, muteExpiration: number}>}
     */
    async unmute() {
        const result = await this.client.unmuteChat(this.id._serialized);
        this.isMuted = result.isMuted;
        this.muteExpiration = result.muteExpiration;
        return result;
    }

    /**
     * Mark this chat as unread
     */
    async markUnread() {
        return this.client.markChatUnread(this.id._serialized);
    }

    /**
     * Loads chat messages, sorted from earliest to latest.
     * @param {Object} searchOptions Options for searching messages.
     * @param {Number} [searchOptions.limit] The amount of messages to return. If no limit is specified, the available messages will be returned. Note that the actual number of returned messages may be smaller if there aren't enough messages in the conversation. Set this to Infinity to load all messages.
     * @param {Boolean} [searchOptions.fromMe] Return only messages from the bot number or vise versa. To get all messages, leave the option undefined.
     * @param {String} [searchOptions.messageId] Return only the message with this id. Accepts a serialized MsgKey (`false_<chat>_<fingerprint>`) or the bare fingerprint. When set, `limit` is ignored and at most one message is returned; an unknown id yields an empty array.
     * @param {Number} [searchOptions.since] Return only messages sent at or after this unix timestamp, in seconds. To get all messages, leave the option undefined.
     * @returns {Promise<Array<Message>>}
     */
    async fetchMessages(searchOptions) {
        let messages = await this.client.pupPage.evaluate(
            async (chatId, searchOptions) => {
                const msgFilter = (m) => {
                    if (m.isNotification) {
                        return false; // dont include notification messages
                    }
                    if (
                        searchOptions &&
                        searchOptions.fromMe !== undefined &&
                        m.id.fromMe !== searchOptions.fromMe
                    ) {
                        return false;
                    }
                    if (
                        searchOptions &&
                        searchOptions.since !== undefined &&
                        Number.isFinite(searchOptions.since) &&
                        m.t < searchOptions.since
                    ) {
                        return false;
                    }
                    return true;
                };

                const chat = await window.WWebJS.getChat(chatId, {
                    getAsModel: false,
                });

                // Addressing a single message: `limit` cannot find it, and
                // silently falling through to "newest N" hands back whatever
                // message happens to be last - the wrong one whenever newer
                // messages have arrived, or when several share the same `t`.
                if (searchOptions && searchOptions.messageId) {
                    const found = await window.WWebJS.findChatMessageById(
                        chat,
                        chatId,
                        searchOptions.messageId,
                    );
                    return found && msgFilter(found)
                        ? [window.WWebJS.getMessageModel(found)]
                        : [];
                }

                let msgs = chat.msgs.getModelsArray().filter(msgFilter);

                if (searchOptions && searchOptions.limit > 0) {
                    const since =
                        searchOptions &&
                        searchOptions.since !== undefined &&
                        Number.isFinite(searchOptions.since)
                            ? searchOptions.since
                            : null;

                    while (msgs.length < searchOptions.limit) {
                        const loadedMessages = await window
                            .require('WAWebChatLoadMessages')
                            .loadEarlierMsgs({ chat });
                        if (!loadedMessages || !loadedMessages.length) break;
                        msgs = [...loadedMessages.filter(msgFilter), ...msgs];

                        // Once a page reaches past `since` there is nothing
                        // left to find, so stop instead of paging back to the
                        // start of the conversation to satisfy `limit`.
                        if (
                            since !== null &&
                            loadedMessages.some((m) => m.t < since)
                        ) {
                            break;
                        }
                    }

                    if (msgs.length > searchOptions.limit) {
                        msgs.sort((a, b) => a.t - b.t);
                        msgs = msgs.splice(msgs.length - searchOptions.limit);
                    }
                }

                return msgs.map((m) => window.WWebJS.getMessageModel(m));
            },
            this.id._serialized,
            searchOptions,
        );

        return messages.map((m) => new Message(this.client, m));
    }

    /**
     * Simulate typing in chat. This will last for 25 seconds.
     */
    async sendStateTyping() {
        return this.client.pupPage.evaluate((chatId) => {
            window.WWebJS.sendChatstate('typing', chatId);
            return true;
        }, this.id._serialized);
    }

    /**
     * Simulate recording audio in chat. This will last for 25 seconds.
     */
    async sendStateRecording() {
        return this.client.pupPage.evaluate((chatId) => {
            window.WWebJS.sendChatstate('recording', chatId);
            return true;
        }, this.id._serialized);
    }

    /**
     * Stops typing or recording in chat immediately.
     */
    async clearState() {
        return this.client.pupPage.evaluate((chatId) => {
            window.WWebJS.sendChatstate('stop', chatId);
            return true;
        }, this.id._serialized);
    }

    /**
     * Returns the Contact that corresponds to this Chat.
     * @returns {Promise<Contact>}
     */
    async getContact() {
        return await this.client.getContactById(this.id._serialized);
    }

    /**
     * Returns array of all Labels assigned to this Chat
     * @returns {Promise<Array<Label>>}
     */
    async getLabels() {
        return this.client.getChatLabels(this.id._serialized);
    }

    /**
     * Add or remove labels to this Chat
     * @param {Array<number|string>} labelIds
     * @returns {Promise<void>}
     */
    async changeLabels(labelIds) {
        return this.client.addOrRemoveLabels(labelIds, [this.id._serialized]);
    }

    /**
     * Gets instances of all pinned messages in a chat
     * @returns {Promise<Array<Message>>}
     */
    async getPinnedMessages() {
        return this.client.getPinnedMessages(this.id._serialized);
    }

    /**
     * Sync chat history conversation
     * @return {Promise<boolean>} True if operation completed successfully, false otherwise.
     */
    async syncHistory() {
        return this.client.syncHistory(this.id._serialized);
    }

    /**
     * Add or edit a customer note
     * @see https://faq.whatsapp.com/1433099287594476
     * @param {string} note The note to add
     * @returns {Promise<void>}
     */
    async addOrEditCustomerNote(note) {
        if (this.isGroup || this.isChannel) return;

        return this.client.addOrEditCustomerNote(this.id._serialized, note);
    }

    /**
     * Get a customer note
     * @see https://faq.whatsapp.com/1433099287594476
     * @returns {Promise<{
     *    chatId: string,
     *    content: string,
     *    createdAt: number,
     *    id: string,
     *    modifiedAt: number,
     *    type: string
     * }>}
     */
    async getCustomerNote() {
        if (this.isGroup || this.isChannel) return null;

        return this.client.getCustomerNote(this.id._serialized);
    }
}

module.exports = Chat;
