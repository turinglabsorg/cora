# Conversation inactivity reminder

Open **Settings → Regia**. Its panels and **Settings → Models and sleep** are always open, without collapsible headers. Under **Inactivity reminder**, enter a whole number of minutes, at least **5**, or enable **∞ No reminder**. Changes save automatically. Existing installations start at **30 minutes**.

The setting applies to all conversations on the instance. A finite interval asks once whether the agent should keep listening after no conversation messages arrive for that interval. Messages from the agent also restart the count. An agent working in the same conversation is not asked while it works. A failed delivery is not retried every minute.

Choosing ∞ disables this question. It never dismisses an agent or closes a conversation; explicit dismissal still ends listening. Changing the setting affects existing conversations without restarting Cora. It retains the last-message timestamp and does not repeat a question that was already asked; a new message rearms it.

The delivered question uses the selected minute count in the instance language. Invalid values are rejected without changing other settings. A failed save restores the last accepted controls and reports an error.

The stored setting is `conversationIdleMinutes`: a whole number >= 5, or JSON `null` for ∞. Finite values must fit a safely represented millisecond interval. No database migration or additional background job is needed.
