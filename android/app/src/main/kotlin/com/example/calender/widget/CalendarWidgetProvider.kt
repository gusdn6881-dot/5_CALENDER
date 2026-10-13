package com.example.calender.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import es.antonborri.home_widget.HomeWidgetPlugin
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CalendarWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    private fun updateAppWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        val widgetData = HomeWidgetPlugin.getData(context)
        val views = RemoteViews(context.packageName, com.example.calender.R.layout.calendar_widget)

        // 1. 오늘 날짜 표시
        val dateFormat = SimpleDateFormat("M월 d일 (E)", Locale.KOREA)
        views.setTextViewText(com.example.calender.R.id.tv_widget_date, dateFormat.format(Date()))

        // 2. 일정 데이터 파싱
        val eventsJson = widgetData.getString("widget_events_json", "[]")
        val eventsArray = JSONArray(eventsJson)
        val eventSummary = StringBuilder()

        if (eventsArray.length() == 0) {
            eventSummary.append("오늘 예정된 일정이 없습니다.")
        } else {
            for (i in 0 until minOf(eventsArray.length(), 2)) {
                val item = eventsArray.getJSONObject(i)
                val time = item.optString("time", "")
                val title = item.optString("title", "")
                eventSummary.append("• [$time] $title\n")
            }
        }
        views.setTextViewText(com.example.calender.R.id.tv_widget_events, eventSummary.toString().trimEnd())

        // 3. 할 일 데이터 파싱
        val todosJson = widgetData.getString("widget_todos_json", "[]")
        val todosArray = JSONArray(todosJson)
        val todoSummary = StringBuilder()

        var uncompletedCount = 0
        for (i in 0 until todosArray.length()) {
            val item = todosArray.getJSONObject(i)
            if (!item.optBoolean("is_completed", false)) {
                uncompletedCount++
                if (uncompletedCount <= 2) {
                    todoSummary.append("□ ${item.optString("title")}\n")
                }
            }
        }

        if (uncompletedCount == 0) {
            views.setTextViewText(com.example.calender.R.id.tv_widget_todos, "남은 할 일이 없습니다.")
        } else {
            views.setTextViewText(com.example.calender.R.id.tv_widget_todos, todoSummary.toString().trimEnd())
        }

        // 4. 위젯 클릭 시 앱 실행 딥링크 인텐트
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("calender://home"))
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(com.example.calender.R.id.widget_container, pendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }
}

