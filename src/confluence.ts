import fetch from "node-fetch";
import { createReadStream } from "fs";
var FormData = require('form-data');

/**
 * Configuration of the client
 */
export interface Config {
    username: string;
    password: string;
    baseUrl: string;
    version?: number;
    apiPath?: string;
}

/**
 * Configuration enhanced with computed information
 */
interface InternalConfig extends Config {
    extension: string;
}

/**
 * Space definition
 */
export interface Space {
    id: number;
    key: string;
    name: string;
    type: string;
    status: string;
    _expandable: {
        settings: string;
        homepage: string;
        identifiers: string;
        [key: string]: string;
    };
    _links: {
        self: string;
        webui: string;
    };
}

/**
 * Page definition
 */
export interface Page {
    id: string;
}

/**
 * Main Confluence API client class
 */
export default class Confluence {
    config: InternalConfig;

    /**
     * Create a new client
     *
     * Password can either be the user password or a user token
     *
     * @param config of the client
     */
    constructor(config: Config) {
        this.config = {
            username: config.username,
            password: config.password,
            baseUrl: config.baseUrl,
            version: config.version,
            apiPath: config.apiPath || (config.version === 4) ? '/rest/prototype/latest' : '/rest/api',
            extension: (config.version === 4) ? '.json' : ''
        };
    }

    /**
     * Do a request on the API
     *
     * @param url to fetch
     * @param method to use
     * @param toJSON parse result into JSON Object
     * @param body content of the request
     */
    async fetch(url: string, method: string = 'GET', toJSON: Boolean = true, body: any = undefined,): Promise<any> {
        const auth = Buffer
            .from(`${this.config.username}:${this.config.password}`)
            .toString("base64");
        let headers: any = {
            "Content-Type": "application/json",
            "Authorization":
                `Basic ${auth}`
        }
        let options: any = {
            headers,
            method
        }
        if (body && typeof (body) !== "string" && typeof (body) !== "undefined") {
            body = JSON.stringify(body);
            options = { ...options, body: body }
        }
        let res = await fetch(url, options);
        if (toJSON) {
            return res.json();
        }
        return await res.buffer();
    }

    /**
     * Return all known spaces to the user
     */
    async getSpaces(options = ''): Promise<Space[]> {
        let spaces = [];
        let start = 0;
        let res;
        do {
            let url = this.config.baseUrl + this.config.apiPath + "/space" + this.config.extension + `?limit=100&start=${start}${options}`;
            res = await this.fetch(url, 'GET', true);
            spaces.push(...res.results);
            start = res.start + res.limit;
        } while (res.size === res.limit)
        // Handle pagination here
        return spaces;
    }

    /**
     * Return one specific space
     *
     * @param space to retrieve
     * @throw Error SPACE not found if not found
     */
    async getSpace(spaceKey: string): Promise<Space> {
        let url = this.config.baseUrl + this.config.apiPath + "/space" + this.config.extension + "?spaceKey=" + spaceKey;
        let res = await this.fetch(url);
        if (res.size === 0) {
            throw new Error("SPACE not found");
        }
        return res.results[0];
    }

    /**
     *
     * @param spaceKey  to retrieve home page from
     */
    async getSpaceHomePage(spaceKey: string): Promise<Page> {
        return await this.fetch(this.config.baseUrl + (await this.getSpace(spaceKey))._expandable.homepage);
    }

    async getContentById(id) {
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + this.config.extension + "?expand=body.storage,version";
        return (await this.fetch(url));
    }

    async getCustomContentById(options: any) {
        let expanders = options.expanders || ['body.storage', 'version'];
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + options.id + this.config.extension + "?expand=" + expanders.join();
        return (await this.fetch(url));
    }

    async getContentByPageTitle(space: string, title: string) {
        let query = "?spaceKey=" + space + "&title=" + title + "&expand=body.storage,version";
        let url = this.config.baseUrl + this.config.apiPath + "/content" + this.config.extension + query;
        return (await this.fetch(url));
    }

    async postContent(space: string, title: string, content: string, parentId: string = undefined, representation: string = "storage") {
        let page = {
            "type": "page",
            "title": title,
            "space": {
                "key": space
            },
            "ancestors": [{
                "type": "page",
                "id": parentId ? parentId : (await this.getSpaceHomePage(space)).id
            }],
            "body": {
                "storage": {
                    "value": content,
                    "representation": representation
                }
            }
        };
        let url = this.config.baseUrl + this.config.apiPath + "/content" + this.config.extension;
        return (await this.fetch(url, 'POST', true, page))
    }

    async putContent(space: string, id: string, version: number, title: string, content: string, minorEdit: boolean, representation: string) {
        var page = {
            "id": id,
            "type": "page",
            "title": title,
            "space": {
                "key": space
            },
            "version": {
                "number": version,
                "minorEdit": minorEdit || false
            },
            "body": {
                "storage": {
                    "value": content,
                    "representation": representation || "storage"
                }
            }
        };
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + this.config.extension + "?expand=body.storage,version";
        return (await this.fetch(url, 'PUT', true, page))
    }

    async deleteContent(id: string) {
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + this.config.extension;
        return (await this.fetch(url, 'DELETE'))
    }

    async getAttachments(space: string, id: string) {
        let query = "?spaceKey=" + space + "&expand=version,container";
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + "/child/attachment" + query;
        return (await this.fetch(url))
    }

    async createAttachment(id: string, filepath: string, comment: string = '', minorEdit: boolean = false) {
        const auth = Buffer
            .from(`${this.config.username}:${this.config.password}`)
            .toString("base64");
        let headers: any = {
            "Content-Type": "multipart/form-data",
            "Authorization": `Basic ${auth}`,
            "X-Atlassian-Token": "nocheck"
        }
        let method = 'POST';
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + "/child/attachment";
        let form = new FormData();
        form.append("comment", comment);
        form.append("minorEdit", minorEdit);
        form.append("file", createReadStream(filepath));
        await fetch(url, { headers, method, body: form.getBuffer() });
    }

    async updateAttachmentData(id: string, attachmentId: string, filepath: string, comment: string = '', minorEdit: boolean = false) {
        const auth = Buffer
            .from(`${this.config.username}:${this.config.password}`)
            .toString("base64");
        let headers: any = {
            "Content-Type": "multipart/form-data",
            "Authorization": `Basic ${auth}`,
            "X-Atlassian-Token": "nocheck"
        };
        let method = 'PUT';
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + "/child/attachment/" + attachmentId + "/data";
        let form = new FormData();
        form.append("comment", comment);
        form.append("minorEdit", minorEdit);
        form.append("file", createReadStream(filepath));
        await fetch(url, { headers, method, body: form.getBuffer() });
    }

    async getLabels(id: string) {
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + "/label";
        return (await this.fetch(url));
    }

    async postLabels(id: string, labels: string) {
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + "/label";
        return (await this.fetch(url, 'POST', true, labels));
    }

    async deleteLabel(id: string, label: string) {
        let url = this.config.baseUrl + this.config.apiPath + "/content/" + id + "/label?name=" + label;
        return (await this.fetch(url, 'DELETE'));

    }

    async search(query: string) {
        let url = this.config.baseUrl + this.config.apiPath + "/search" + this.config.extension + "?" + query;
        return (await this.fetch(url));
    }

    async getContentChildByContentId(id: string, child_type: string) {
        let url = this.config.baseUrl + this.config.apiPath +
            "/content/" + id +
            "/child/" + child_type + "?expand=body.storage,version";
        return (await this.fetch(url));
    }

    async getContentDescendantByContentId(id: string, child_type: string) {
        let url = this.config.baseUrl + this.config.apiPath +
            "/content/" + id +
            "/descendant/" + child_type + "?expand=body.storage,version";
        return (await this.fetch(url));
    }

    async getPageAsPdf(id): Promise<any> {
        let url = this.config.baseUrl + `/spaces/flyingpdf/pdfpageexport.action?pageId=${id}`;
        let res = await this.fetch(url, 'GET', false);
        // extract ajs-taskId
        let taskIdRegex = /name=\"ajs-taskId\" content=\"(.*?)\">/;
        let taskId = taskIdRegex.exec(res)[1];
        let timeout = 24;
        while (timeout-- > 0) {
            // pending for 5s
            await new Promise(resolve => setTimeout(resolve, 5000));
            let taskUrl = this.config.baseUrl + `/runningtaskxml.action?taskId=${taskId}`;
            let statusResAsText = await this.fetch(taskUrl, 'GET', false);
            // read pdf processing status
            let isCompleteRegex = /<isComplete>(.*?)<\/isComplete>/;
            let isComplete = isCompleteRegex.exec(statusResAsText);
            //
            if (isComplete && isComplete[1] === "true") {
                let isSuccessfullRegex = /<isSuccessful>(.*?)<\/isSuccessful>/;
                let isSuccessful = isSuccessfullRegex.exec(statusResAsText);
                if (!isSuccessful || isSuccessful[1] !== "true") {
                    throw new Error("Pdf could not be retrieved");
                }
                let pdfUrlRegex = /href=&quot;\/wiki\/(.*?)&quot/;
                let pdfUrl = this.config.baseUrl + "/" + pdfUrlRegex.exec(statusResAsText)[1];
                let pdfresp = await this.fetch(pdfUrl, 'GET', false);
                return pdfresp;
            }
        }
        throw new Error("Pdf Generation Timeout");
    }
}

export { Confluence };