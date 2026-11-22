package com.homaklab.cast

/** Company name shown on the main screen (set in settings). Mirrors the receiver's `normalizeCompanyName`. */
object Branding {
    const val DEFAULT_COMPANY = "The Land of Legends"
    private const val MAX_LENGTH = 60

    /** Single line, whitespace collapsed, at most 60 chars; empty input falls back to the default brand. */
    fun normalize(value: String?): String {
        val text = value.orEmpty()
            .map { if (it.code < 32 || it.code == 127) ' ' else it }
            .joinToString("")
            .split(' ')
            .filter { it.isNotEmpty() }
            .joinToString(" ")
            .take(MAX_LENGTH)
            .trim()
        return text.ifEmpty { DEFAULT_COMPANY }
    }

    fun isDefault(name: String): Boolean = name.equals(DEFAULT_COMPANY, ignoreCase = true)
}
