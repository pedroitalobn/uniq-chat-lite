//go:build ignore

package main

import (
	"fmt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
	"github.com/uniq-chat/backend/internal/models"
)

func main() {
	db, err := gorm.Open(sqlite.Open("/tmp/test5.db"), &gorm.Config{Logger: gormLogger.Default.LogMode(gormLogger.Info)})
	if err != nil {
		panic(err)
	}
	
	err = db.AutoMigrate(&models.Journey{}, &models.JourneyExecution{})
	if err != nil {
		fmt.Println("Error:", err)
	} else {
		fmt.Println("Success!")
	}
}
