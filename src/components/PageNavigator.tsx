import { $sort } from "../stores/sort.store";

type Props = {
  /** The series ID is used to compose the URL on the link navigation */
  id: number | string;
  numberOfPages: number;
  currentPage: number;
};
export function PageNavigator({ id, numberOfPages, currentPage }: Props) {
  const sort = $sort.get();
  let pagesArray: (string | number)[] = [];

  if (numberOfPages > 8) {
    if (currentPage < 5) {
      pagesArray = [1, 2, 3, 4, 5, "...", numberOfPages];
    } else if (currentPage > numberOfPages - 4) {
      pagesArray = [
        1,
        "...",
        numberOfPages - 4,
        numberOfPages - 3,
        numberOfPages - 2,
        numberOfPages - 1,
        numberOfPages,
      ];
    } else {
      pagesArray = [
        1,
        "...",
        currentPage - 1,
        currentPage,
        currentPage + 1,
        "...",
        numberOfPages,
      ];
    }
  } else {
    pagesArray = Array.from({ length: numberOfPages }, (_, i) => i + 1);
  }
  return (
    <nav class="flex justify-center mt-8">
      <ul class="flex gap-4">
        {pagesArray.map((page) => (
          <li>
            {page === "..." ? (
              <span>{page}</span>
            ) : (
              <a
                href={`/series/${id}/${page}?sort=${sort}`}
                class={page === currentPage ? "underline" : ""}
              >
                {page}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
