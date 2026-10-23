/**
 * Sorting a list of people.
 *
 * The client holds the people on the device, so the list is sorted here
 * rather than by asking the server: the sort has to keep working with the
 * network switched off.
 */

/**
 * The key a person is sorted by.
 *
 * The key is not always the value: a name is sorted by its parts, a date by
 * its digits, and a status or a gender by the order the school thinks about
 * them in rather than alphabetically.
 */
export function peopleSortKey(record: { data: Record<string, unknown> }, field: string): string {
  const data = record.data;
  switch (field) {
    case "name": {
      const first = (data.firstName as string) ?? "";
      const middle = (data.middleName as string) ?? "";
      const last = (data.lastName as string) ?? "";
      return [first, middle, last].filter(Boolean).join(" ").toLowerCase();
    }
    case "admissionNumber":
      return String(data.admissionNumber ?? "").padStart(10, "0");
    case "status": {
      const order = ["active", "inactive", "graduated", "withdrawn", "transferred"];
      return (
        String(data.status ?? "").padStart(2, "0") +
        (order.indexOf(data.status as string) + 1).toString()
      );
    }
    case "admissionDate":
    case "dateOfBirth":
      return String(data[field] ?? "").replace(/-/g, "");
    case "gender": {
      const order = ["female", "male", "other", "undisclosed"];
      return (order.indexOf(data.gender as string) + 1).toString();
    }
    default:
      return String(data[field] ?? "").toLowerCase();
  }
}

/**
 * Sort the people in a list.
 */
export function sortPeople(
  records: readonly { data: Record<string, unknown> }[],
  sortField: string,
  direction: "asc" | "desc",
): { data: Record<string, unknown> }[] {
  return [...records].sort((a, b) => {
    const aKey = peopleSortKey(a, sortField);
    const bKey = peopleSortKey(b, sortField);
    if (aKey === bKey) {
      return 0;
    }
    const cmp = aKey.localeCompare(bKey, undefined, { numeric: true });
    return direction === "asc" ? cmp : -cmp;
  });
}
