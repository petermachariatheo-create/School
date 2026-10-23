import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { listEntities, type EntityMeta, type FieldSpec } from "../src/app/fields.ts";
import {
  CATALOG_GROUPS,
  entityGroups,
  groupFor,
  iconFor,
  sectionsFor,
} from "../src/app/catalog.ts";

/**
 * The catalogue.
 *
 * The catalogue decides what the navigation looks like and how a form is
 * arranged, so a mistake here is visible on every screen.
 */

const entities = listEntities();

describe("the navigation catalogue", () => {
  test("every entity type belongs to a group", () => {
    for (const entity of entities) {
      const group = groupFor(entity.type);
      assert.ok(
        group.types.includes(entity.type),
        `${entity.type} is not in the group it is looked up in`,
      );
    }
  });

  test("the groups are the ones the school thinks in", () => {
    assert.deepEqual(
      CATALOG_GROUPS.map((group) => group.id),
      ["people", "academic", "finance"],
    );
  });

  test("every entity type has an icon", () => {
    for (const entity of entities) {
      assert.notEqual(iconFor(entity.type), "");
    }
  });

  test("an unknown type still has an icon and a group", () => {
    assert.equal(iconFor("unicorn"), "record");
    assert.equal(groupFor("unicorn").id, "other");
  });

  test("the navigation lists every entity type once", () => {
    const listed = entityGroups(entities).flatMap((entry) => entry.types);
    assert.equal(listed.length, entities.length);
    assert.equal(new Set(listed).size, entities.length);
  });

  test("a type the catalogue does not know goes into the other group", () => {
    const invented: EntityMeta = {
      type: "unicorn",
      label: "Unicorn",
      restPath: "unicorns",
      fields: [],
      editable: [],
      computed: [],
      maintained: [],
    };
    const groups = entityGroups([...entities, invented]);
    const other = groups.find((entry) => entry.group.id === "other");
    assert.deepEqual(other?.types, ["unicorn"]);
  });
});

describe("the arrangement of a form", () => {
  test("every editable field ends up in a section", () => {
    for (const entity of entities) {
      const sections = sectionsFor(entity);
      const placed = sections.flatMap((section) => section.fields.map((field) => field.name));
      const expected = [
        ...entity.editable.map((field) => field.name),
        ...entity.computed.map((field) => field.name),
        ...entity.maintained.map((field) => field.name),
      ];
      assert.deepEqual(placed.sort(), expected.sort(), `${entity.type} lost a field`);
    }
  });

  test("a field the server works out is shown but never asked for", () => {
    const invoice = entities.find((entity) => entity.type === "invoice")!;
    const total = invoice.computed.find((field) => field.name === "totalAmount");
    assert.ok(total !== undefined, "the invoice total is not marked as computed");
    assert.equal(
      invoice.editable.some((field) => field.name === "totalAmount"),
      false,
      "the form still asks for the total",
    );
    assert.equal(total.computedFrom, "lineItems");

    const sections = sectionsFor(invoice);
    const billing = sections.find((section) => section.id === "billing");
    const names = billing?.fields.map((field) => field.name) ?? [];
    assert.ok(names.includes("totalAmount"), "the total is not shown with the billing");
    assert.ok(
      names.indexOf("totalAmount") > names.indexOf("lineItems"),
      "the total is shown before the line items it comes from",
    );
  });

  test("a total the server keeps is shown but never asked for", () => {
    const invoice = entities.find((entity) => entity.type === "invoice")!;
    const paid = invoice.maintained.find((field) => field.name === "paidAmount");
    assert.ok(paid !== undefined, "the amount paid is not marked as maintained");
    assert.equal(
      invoice.editable.some((field) => field.name === "paidAmount"),
      false,
      "the form still asks for the amount paid",
    );
    assert.equal(
      invoice.computed.some((field) => field.name === "paidAmount"),
      false,
      "the client cannot work the amount paid out for itself",
    );

    const sections = sectionsFor(invoice);
    const billing = sections.find((section) => section.id === "billing");
    const names = billing?.fields.map((field) => field.name) ?? [];
    assert.ok(names.includes("paidAmount"), "the amount paid is not shown with the billing");
  });

  test("the server's own bookkeeping is not asked for in a form", () => {
    for (const entity of entities) {
      const sections = sectionsFor(entity);
      const placed = new Set(
        sections.flatMap((section) => section.fields.map((field) => field.name)),
      );
      for (const name of ["id", "revision", "createdAt", "updatedAt", "deletedAt"]) {
        assert.equal(placed.has(name), false, `${entity.type} asks for ${name}`);
      }
    }
  });

  test("a student asks for identity before contact", () => {
    const sections = sectionsFor(entities.find((entity) => entity.type === "student")!);
    assert.equal(sections[0]?.id, "identity");
    assert.equal(sections[1]?.id, "contact");
  });

  test("a class keeps its room with the schedule", () => {
    const sections = sectionsFor(entities.find((entity) => entity.type === "class")!);
    const schedule = sections.find((section) => section.id === "schedule");
    assert.deepEqual(
      schedule?.fields.map((field) => field.name),
      ["room"],
    );
  });

  test("a record with no field left over has no details section", () => {
    const sections = sectionsFor(entities.find((entity) => entity.type === "student")!);
    assert.equal(
      sections.some((section) => section.id === "general"),
      false,
    );
  });

  test("a field the catalogue does not place is still shown", () => {
    const invented: FieldSpec = {
      name: "timetableSlot",
      label: "Timetable Slot",
      kind: "text",
      nullable: false,
      required: false,
      options: [],
      readOnly: false,
      computed: false,
      computedFrom: null,
      maintained: false,
      serverDecided: [],
      defaultValue: undefined,
      description: null,
      minimum: null,
      maximum: null,
      maxLength: null,
      format: null,
      pattern: null,
    };
    const entity: EntityMeta = {
      type: "lesson",
      label: "Lesson",
      restPath: "lessons",
      fields: [invented],
      editable: [invented],
      computed: [],
      maintained: [],
    };
    const sections = sectionsFor(entity);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.id, "general");
    assert.equal(sections[0]?.fields[0]?.name, "timetableSlot");
  });

  test("every section has a label to show", () => {
    for (const entity of entities) {
      for (const section of sectionsFor(entity)) {
        assert.notEqual(section.label, "");
      }
    }
  });
});
