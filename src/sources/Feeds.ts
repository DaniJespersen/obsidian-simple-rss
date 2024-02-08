import { Notice, Vault } from "obsidian";
import SimpleRSSFeed from "src/models/SimpleRSSFeed";
import SimpleRSSFeedType from "src/models/SimpleRSSFeedType";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import Parser from "rss-parser";
import { describe } from "node:test";
const TurnDownService = require('turndown')
const turndown = new TurnDownService()


async function extractGuidFromNoteContent(vault: Vault, file: TFile): Promise<string> {
    const content = await vault.read(file);
    // Use a regular expression to extract the GUID from the content
    // For example, if the GUID is in the YAML frontmatter:
    const match = content.match(/^guid:\s*(.+)$/m);
    if (match && match[1]) {
        return match[1].trim();
    }
    return ""; // Return an empty string if no GUID is found
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&amp;/g, '&'); // Make sure to do this last!
}

function reformatPubDate(pubDate) {
    // Parse the pubDate string into a Date object
    const date = new Date(pubDate);
    
    // Extract the day, month, and year from the Date object
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0'); // getUTCMonth() returns 0-11
    const year = date.getUTCFullYear().toString().slice(-2); // Get the last two digits of the year

    // Format the date in "DD.MM.YY" format
    return `${day}.${month}.${year}`;
}

export default class Feeds {
	feeds: SimpleRSSFeed[] = [];
	feedTypes: SimpleRSSFeedType[] = [];
	defaultPath = "";
	defaultTemplate = "";
	Mustache = require("mustache");

	constructor() {
		this.feeds = [];
		this.feedTypes = [];
	}

	setFeeds(feeds: SimpleRSSFeed[]): Feeds {
		this.feeds = feeds;
		return this;
	}

	setFeedTypes(feedTypes: SimpleRSSFeedType[]): Feeds {
		this.feedTypes = feedTypes;
		return this;
	}

	setDefaultTemplate(defaultTemplate: string): Feeds {
		this.defaultTemplate = defaultTemplate;
		return this;
	}

	setDefaultPath(defaultPath: string): Feeds {
		this.defaultPath = defaultPath;
		return this;
	}

	syncFeeds(vault: Vault): void {
		this.feeds.forEach((feed) => {
			const feedType = this.feedTypes.find(
				(feedType) => feedType.id === feed.feedTypeId
			);
			this.syncOneFeed(vault, feed, feedType);
		});
	}

	async syncOneFeed(vault: Vault, feed: SimpleRSSFeed, feedType?: SimpleRSSFeedType) {
		new Notice("Sync Feed: " + feed.name);

		const content = await this.getUrlContent(feed.url, feedType);
		const existingFiles = await vault.getFiles();

		const existingGuids = new Set(existingFiles.map(file => {
			// Extract the GUID from the note's content or a specific location within the note.
			return extractGuidFromNoteContent(vault, file);
		}));


		for (const item of content.items) {


			const path = feed.path ?? this.defaultPath;


			const title = feed.title
				? this.parseItem(feed.title, item, content)
				: (item.title);

			console.log("############")
			console.log("Looking at title: ", title)
			console.log("############")
			console.log("\n\n")
			console.log("##########")
			console.log("Looking at Item", item)
			console.log("\n\n")
			
			const text = this.parseItem(
				feed.template ?? this.defaultTemplate,
				item,
				content,
	
			);

			console.log("##############")
			console.log("Looking at text: ", text);
			console.log("##############")
			console.log("Looking at Content:", content)
			console.log("##############")
			console.log("\n\n")
			// Use the GUID as a unique identifier for the item
			const itemGuid = item.guid;
	
			// Check if the item's GUID is already used in an existing note
			if (!existingGuids.has(itemGuid)) {
				// sanitize title 
				const sanitizedTitle = title.replace(/[*"\\<>/:|?#\r\n^]/gi, "");
				const date = item.pubDate ? reformatPubDate(item.pubDate) : item.isoDate

				// Create a new file in the vault
				try {
					console.log("inside create file: ", item.pubDate)
					const createdFile = await vault.create(path + "/" + date + " - " + sanitizedTitle + ".md", text);

					new Notice("Note created :" + path + "/" + date + " - " + sanitizedTitle);
				} catch (error) {
					if (!error.message.includes("File already exists")) {
						console.error(error);
						new Notice("Error creating note :" + error);
					}
				}
			} else {
				// The item already exists as a note, so you can skip or update it
				console.log("Item already exists: " + itemGuid);
			}
		}
	}


	getUrlContent(url: string, feedType?: SimpleRSSFeedType) {
		const myFeedType = feedType
			? {
					customFields: {
						feed: feedType.feed,
						item: feedType.item,
					},
			  }
			: undefined;
		const parser: Parser = new Parser(myFeedType);

		return parser.parseURL(url);
	}

	getValue(data: any, keys: string | string[]): any {
		// If plain string, split it to array
		if (typeof keys === "string") {
			keys = keys.split(".");
		}

		// Get key
		var key: string | undefined = keys.shift();

		// Get data for that key
		var keyData = data[key ?? ""];

		// Check if there is data
		if (!keyData) {
			return undefined;
		}

		// Check if we reached the end of query string
		if (keys.length === 0) {
			return keyData;
		}

		// recursive call!
		return this.getValue(Object.assign({}, keyData), keys);
	}

	replaceField(template: string, kind: string, values: any): string {
		const regex = new RegExp("{{" + kind + "\\.[^}]+}}", "g");
		let result = template;
		let match;
		match = regex.exec(result);
		match?.forEach((m) => {
			const key = m.replace("{{" + kind + ".", "").replace("}}", "");
			result = result.replaceAll(m, this.getValue(values, key) ?? "");
		});
		return result;
	}

	replaceFieldsMustache(template: string, values: any): string {
		return this.Mustache.render(template, values);
	}

	parseItem(template: string, item: any, feed: any): string {
		console.log("####Description = ", item.content)
		console.log("Item = ", item)
		if (item.content) {
			item.content = turndown.turndown(item.content);
		}
		let categories = "";
		if (item.categories) {
			item.categories.forEach((category: string) => {
				categories += "- " + category + "\n";
				console.log("Categories: ", categories)
			});
		}

		
		console.log("outside categories if: ", categories)
		let result = template.replaceAll("{{item.categories}}", categories);

		// find all {{item.*}} and replace them with the value
		// result = this.replaceField(result, "feed", feed);
		// result = this.replaceField(result, "item", item);
		result = this.replaceFieldsMustache(result, { feed, item });

		return result;
	}
}
