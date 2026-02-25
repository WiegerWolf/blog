import { sortFeedItemsDesc, toThreadFeedItem, type ThreadModule } from "../../../lib/threadFeed";
import {
  buildThreadPagePayload,
  getThreadPageCount,
  jsonThreadPageResponse,
  type ThreadPagePayload
} from "../../../lib/threadFeedPaging";

interface StaticPathProps {
  payload: ThreadPagePayload;
}

function collectThreadItems() {
  const modules = [
    ...Object.values(import.meta.glob("../../en/blog/*.md", { eager: true })),
    ...Object.values(import.meta.glob("../../ru/blog/*.md", { eager: true }))
  ] as ThreadModule[];

  return sortFeedItemsDesc(
    modules.map((module) => toThreadFeedItem(module, module.url.startsWith("/ru/") ? "ru" : "en"))
  );
}

export async function getStaticPaths() {
  const items = collectThreadItems();
  const pageCount = getThreadPageCount(items.length);

  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    const payload = buildThreadPagePayload(items, page);

    if (!payload) {
      throw new Error(`Failed to build /api/threads/${page}.json`);
    }

    return {
      params: { page: String(page) },
      props: { payload }
    };
  });
}

export async function GET(context: { props: StaticPathProps }) {
  return jsonThreadPageResponse(context.props.payload);
}
