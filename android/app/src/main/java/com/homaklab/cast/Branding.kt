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

    /**
     * "Company · Device" as shown on the receiver (the server keeps at most [max] characters). The company is
     * shortened first so the device name always survives.
     */
    fun deviceLabel(company: String, device: String, max: Int = 80): String {
        val name = device.trim()
        val separator = " · "
        val room = max - name.length - separator.length
        if (room < 3) return name.take(max)
        return company.take(room).trimEnd() + separator + name
    }

    fun isDefault(name: String): Boolean = name.equals(DEFAULT_COMPANY, ignoreCase = true)
}
