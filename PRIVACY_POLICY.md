# Privacy Policy

**Effective Date:** August 29, 2026

LFCbot ("we," "us," or "the Bot") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use the Discord bot.

## 1. Information We Collect

When you interact with LFCbot, we collect and store:

- **Discord User Information**: Your Discord user ID and display name
- **Listing Content**: The text, preferences, and metadata of have/want listings you create
- **Card Metadata**: Information from Scryfall about Magic: The Gathering cards you search or list
- **Server Configuration**: Settings configured by server administrators (timezone, digest schedule, channel preferences)

We do **not** collect:
- Your email address or other contact information
- Payment information
- Message content outside of bot commands
- IP addresses or device information
- Browsing history

## 2. How We Use Your Information

We use the information you provide to:
- Post and manage your have/want listings
- Search and display active listings from other users
- Deliver configured digest notifications
- Resolve cards against the Scryfall API
- Enforce our Terms of Service and prevent abuse

We use your Discord user ID as the primary identifier for your listings. Your display name is shown publicly to other users when they view your listings.

## 3. Data Storage and Security

- **Storage**: All user data is stored in a file-based SQLite database on the server hosting the bot
- **Encryption**: Data is not encrypted at rest; only use the bot with information you're comfortable sharing with other server members
- **Access**: Only the bot application has access to the database. No third parties have access to your data except as required by law
- **Scryfall Integration**: Card searches are passed to Scryfall's public API; see [Scryfall's privacy policy](https://scryfall.com/docs/api) for their data handling

## 4. Data Retention

- **Active Listings**: Stored while active and for 30 days after expiration
- **Fulfilled/Deleted Listings**: Removed immediately upon your request
- **Guild Data**: When the bot is removed from a server, all associated listing data is removed after a 30-day retention window
- **Server Configuration**: Stored indefinitely until the bot is removed from the server

## 5. User Rights

You have the right to:
- **Access**: Request information about your listings by using `/mylistings`
- **Delete**: Remove any of your listings at any time using `/delete`
- **Correct**: Edit your listings using `/edit`

To request deletion of all your data or to exercise privacy rights, contact the server administrator or open an issue on our [GitHub repository](https://github.com/mkane848/lfcbot).

## 6. Data Sharing

We do **not** sell, trade, or share your data with third parties. Your data may be shared only:
- With Discord (as required to deliver the bot's functionality)
- With Scryfall (when resolving card information)
- If required by law or legal process

## 7. Children's Privacy

LFCbot is not intended for users under 13 years old. We do not knowingly collect information from children under 13. If you become aware that a child under 13 has provided us with information, please contact us immediately.

## 8. Third-Party Services

LFCbot integrates with:
- **Discord API**: For bot functionality (see [Discord Privacy Policy](https://discord.com/privacy))
- **Scryfall API**: For Magic: The Gathering card data (see [Scryfall Privacy Policy](https://scryfall.com/docs/api))

## 9. Changes to This Policy

We may update this Privacy Policy at any time. Changes will be posted to this page with an updated "Effective Date." Your continued use of the bot constitutes acceptance of the updated policy.

## 10. Contact Us

For privacy inquiries, questions, or requests, please:
- Open an issue on our [GitHub repository](https://github.com/mkane848/lfcbot)
- Contact the bot owner or your server administrator

---

**Last Updated:** August 29, 2026
