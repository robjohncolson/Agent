import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_MIN_QUESTIONS = 15;
const DEFAULT_MAX_QUESTIONS = 40;

const EXPECTED_HEADER_FIELDS = [
  "Question #",
  "Question Text",
  "Answer 1",
  "Answer 2",
  "Answer 3\n(Optional)",
  "Answer 4\n(Optional)",
  "Time Limit (sec)\n(Max: 300 seconds)",
  "Correct Answer(s)\n(Only include Answer #)",
];

const NON_ASCII_REGEX = /[^\x00-\x7F]/;

const ANSWER_ASCII_REPLACEMENTS = [
  { pattern: /p\u0302/g, replacement: "p-hat" },
  { pattern: /\u2260/g, replacement: "!=" },
  { pattern: /\u2192/g, replacement: "->" },
  { pattern: /\u2264/g, replacement: "<=" },
  { pattern: /\u2265/g, replacement: ">=" },
  { pattern: /\u03C0/g, replacement: "pi" },
  { pattern: /\u03BC/g, replacement: "mu" },
  { pattern: /\u03C3/g, replacement: "sigma" },
];

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; ) {
    const char = csvText[i];

    if (inQuotes) {
      if (char === "\"") {
        if (csvText[i + 1] === "\"") {
          field += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }

      field += char;
      i += 1;
      continue;
    }

    if (char === "\"") {
      if (field.length === 0) {
        inQuotes = true;
      } else {
        field += char;
      }
      i += 1;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";

      if (char === "\r" && csvText[i + 1] === "\n") {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    field += char;
    i += 1;
  }

  if (inQuotes) {
    return { rows: [], error: "Unterminated quoted field." };
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return { rows, error: null };
}

function stringifyCsv(rows, newline = "\n") {
  return rows
    .map((row) =>
      row
        .map((value = "") => {
          if (/[",\r\n]/.test(value)) {
            return `"${value.replace(/"/g, "\"\"")}"`;
          }
          return value;
        })
        .join(",")
    )
    .join(newline);
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isBlankRow(row) {
  return row.every((field) => field.trim() === "");
}

function countTrailingBlankRows(rows) {
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (!isBlankRow(rows[i])) {
      break;
    }
    count += 1;
  }
  return count;
}

function asInteger(value) {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  return Number(value.trim());
}

function replaceAnswerSymbols(answerText) {
  let value = answerText;
  let replacements = 0;

  for (const { pattern, replacement } of ANSWER_ASCII_REPLACEMENTS) {
    const matches = value.match(pattern);
    if (!matches) {
      continue;
    }
    replacements += matches.length;
    value = value.replace(pattern, replacement);
  }

  return { value, replacements };
}

function getQuestionBounds(options) {
  const minQuestions = Number.isInteger(options.minQuestions)
    ? options.minQuestions
    : DEFAULT_MIN_QUESTIONS;
  const maxQuestions = Number.isInteger(options.maxQuestions)
    ? options.maxQuestions
    : DEFAULT_MAX_QUESTIONS;

  return { minQuestions, maxQuestions };
}

export function validateBlooketCsv(csvPath, options = {}) {
  const errors = [];
  const { minQuestions, maxQuestions } = getQuestionBounds(options);

  if (!existsSync(csvPath)) {
    errors.push(`File not found: ${csvPath}`);
    return { valid: false, errors };
  }

  const fileBuffer = readFileSync(csvPath);
  if (fileBuffer.length === 0) {
    errors.push("CSV file is empty.");
    return { valid: false, errors };
  }

  const csvText = fileBuffer.toString("utf-8");
  const csvTextNoBom = csvText.startsWith("\uFEFF") ? csvText.slice(1) : csvText;

  if (csvText.startsWith("\uFEFF")) {
    errors.push("UTF-8 BOM detected; remove the leading BOM character.");
  }

  if (!csvTextNoBom.startsWith("\"Blooket")) {
    errors.push("Row 1 must start with \"Blooket\" import template header.");
  }

  const { rows, error: parseError } = parseCsv(csvTextNoBom);
  if (parseError) {
    errors.push(`CSV parse error: ${parseError}`);
    return { valid: false, errors };
  }

  if (rows.length < 2) {
    errors.push("CSV must include row 1 template header and row 2 column headers.");
    return { valid: false, errors };
  }

  const row1Field = rows[0]?.[0] ?? "";
  if (!row1Field.startsWith("Blooket")) {
    errors.push("Row 1 first field must begin with \"Blooket\".");
  }

  const headerRow = rows[1];
  if (headerRow.length !== 26) {
    errors.push(`Row 2 must contain exactly 26 fields; found ${headerRow.length}.`);
  }

  for (let index = 0; index < EXPECTED_HEADER_FIELDS.length; index += 1) {
    const actual = normalizeNewlines(headerRow[index] ?? "");
    const expected = EXPECTED_HEADER_FIELDS[index];
    if (actual !== expected) {
      errors.push(
        `Row 2 header mismatch in column ${index + 1}; expected "${expected}" but found "${actual}".`
      );
    }
  }

  let expectedQuestionNumber = 1;
  const dataRows = rows.slice(2);

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const rowNumber = index + 3;

    if (row.length !== 26) {
      errors.push(`Row ${rowNumber} must contain exactly 26 fields; found ${row.length}.`);
    }

    const getField = (columnIndex) => row[columnIndex] ?? "";

    const questionNumberText = getField(0).trim();
    const questionNumberValue = asInteger(questionNumberText);
    if (questionNumberValue !== expectedQuestionNumber) {
      errors.push(
        `Row ${rowNumber} Question # must be sequential integer ${expectedQuestionNumber}; found "${getField(0)}".`
      );
    }
    expectedQuestionNumber += 1;

    if (getField(1).trim() === "") {
      errors.push(`Row ${rowNumber} Question Text must be non-empty.`);
    }

    for (let answerIndex = 2; answerIndex <= 5; answerIndex += 1) {
      const answerValue = getField(answerIndex);
      if (answerValue.trim() === "") {
        errors.push(`Row ${rowNumber} Answer ${answerIndex - 1} must be non-empty.`);
      }
      if (answerValue.includes(",")) {
        errors.push(
          `Row ${rowNumber} Answer ${answerIndex - 1} contains a comma; commas inside answers are not allowed.`
        );
      }
    }

    const timeLimit = asInteger(getField(6));
    if (timeLimit === null || timeLimit < 10 || timeLimit > 300) {
      errors.push(
        `Row ${rowNumber} Time limit must be an integer between 10 and 300; found "${getField(6)}".`
      );
    }

    const correctAnswer = asInteger(getField(7));
    if (correctAnswer === null || correctAnswer < 1 || correctAnswer > 4) {
      errors.push(
        `Row ${rowNumber} Correct answer must be an integer from 1 to 4; found "${getField(7)}".`
      );
    }

    for (let columnIndex = 0; columnIndex < 8; columnIndex += 1) {
      const value = getField(columnIndex);
      if (NON_ASCII_REGEX.test(value)) {
        errors.push(
          `Row ${rowNumber} column ${columnIndex + 1} contains non-ASCII characters; use ASCII only in columns 1-8.`
        );
        break;
      }
    }

    const nonEmptyTailColumns = [];
    for (let columnIndex = 8; columnIndex < 26; columnIndex += 1) {
      if (getField(columnIndex).trim() !== "") {
        nonEmptyTailColumns.push(columnIndex + 1);
      }
    }
    if (nonEmptyTailColumns.length > 0) {
      errors.push(
        `Row ${rowNumber} fields 9-26 must be empty; found data in column(s): ${nonEmptyTailColumns.join(", ")}.`
      );
    }
  }

  const trailingBlankRows = countTrailingBlankRows(rows);
  if (trailingBlankRows > 0) {
    errors.push(`CSV has ${trailingBlankRows} trailing blank line(s).`);
  }

  const questionCount = Math.max(0, dataRows.length - trailingBlankRows);
  if (questionCount < minQuestions || questionCount > maxQuestions) {
    errors.push(
      `Question count must be between ${minQuestions} and ${maxQuestions}; found ${questionCount}.`
    );
  }

  return { valid: errors.length === 0, errors };
}

export function autoFixBlooketCsv(csvPath) {
  const changes = [];

  if (!existsSync(csvPath)) {
    return { fixed: false, changes };
  }

  const fileBuffer = readFileSync(csvPath);
  if (fileBuffer.length === 0) {
    return { fixed: false, changes };
  }

  let csvText = fileBuffer.toString("utf-8");
  const newline = csvText.includes("\r\n") ? "\r\n" : "\n";
  let changed = false;

  if (csvText.startsWith("\uFEFF")) {
    csvText = csvText.slice(1);
    changed = true;
    changes.push("Stripped UTF-8 BOM.");
  }

  const parsed = parseCsv(csvText);
  if (parsed.error) {
    if (changed) {
      writeFileSync(csvPath, csvText, "utf-8");
    }
    return { fixed: changed, changes };
  }

  const rows = parsed.rows;

  let strippedBlankRows = 0;
  while (rows.length > 0 && isBlankRow(rows[rows.length - 1])) {
    rows.pop();
    strippedBlankRows += 1;
  }
  if (strippedBlankRows > 0) {
    changed = true;
    changes.push(`Stripped ${strippedBlankRows} trailing blank line(s).`);
  }

  let commaFixCount = 0;
  let symbolFixCount = 0;

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let columnIndex = 2; columnIndex <= 5; columnIndex += 1) {
      if (columnIndex >= row.length) {
        continue;
      }

      const original = row[columnIndex];
      let updated = original;

      const commas = updated.match(/,/g);
      if (commas) {
        commaFixCount += commas.length;
        updated = updated.replace(/,/g, ";");
      }

      const symbolResult = replaceAnswerSymbols(updated);
      updated = symbolResult.value;
      symbolFixCount += symbolResult.replacements;

      if (updated !== original) {
        row[columnIndex] = updated;
        changed = true;
      }
    }
  }

  if (commaFixCount > 0) {
    changes.push(`Replaced ${commaFixCount} comma(s) inside answer fields with semicolons.`);
  }
  if (symbolFixCount > 0) {
    changes.push(`Replaced ${symbolFixCount} non-ASCII symbol(s) in answer fields.`);
  }

  if (changed) {
    writeFileSync(csvPath, stringifyCsv(rows, newline), "utf-8");
  }

  return { fixed: changed, changes };
}
